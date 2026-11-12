package app.nyvemi.nativebridge

import android.app.ActivityManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.PlaybackParams
import android.os.SystemClock
import android.util.Log
import expo.modules.kotlin.Promise
import java.util.concurrent.Executors

internal class NyvemiQwenSpeech {
  data class Tuning(val rate: Double, val pitch: Double, val volume: Double) {
    init {
      require(rate in 0.8..1.2 && pitch in 0.9..1.1 && volume in 0.25..1.0)
    }
  }

  private class Utterance(val id: String, val text: String, val speaker: String) {
    val lock = Object()
    var preparing: Promise? = null
    var playing: Promise? = null
    var tuning: Tuning? = null
    var ready = false
    var cancelled = false
    var ended = false
    var output: AudioTrack? = null

    fun cancel() = synchronized(lock) {
      cancelled = true
      output?.pause()
      output?.flush()
      preparing?.resolve(false)
      preparing = null
      playing?.resolve(false)
      playing = null
      lock.notifyAll()
    }
  }

  private val worker = Executors.newSingleThreadExecutor()
  private val player = Executors.newSingleThreadExecutor()
  private val jobs = LinkedHashMap<String, Utterance>()
  private var engine = 0L // Owned by worker.
  private var warming = false

  fun available(ctx: Context) =
    NyvemiQwenNative.available && (NyvemiQwenPack.installed(ctx) || NyvemiQwenPack.bundled(ctx))

  fun warm(ctx: Context) {
    if (warming || !available(ctx)) return
    warming = true
    worker.execute {
      try {
        load(ctx)
      } catch (e: Exception) {
        Log.w(TAG, "Warmup unavailable: ${e.message}")
      }
    }
  }

  fun prepare(ctx: Context, id: String, text: String, speaker: String, promise: Promise) {
    val job = find(id, text, speaker) ?: Utterance(id, text, speaker)
    synchronized(job.lock) {
      if (job.ready || job.ended) {
        promise.resolve(job.ready && !job.cancelled)
      } else {
        job.preparing?.resolve(false)
        job.preparing = promise
      }
    }
    start(ctx, job)
  }

  fun play(ctx: Context, id: String, text: String, speaker: String, tuning: Tuning, promise: Promise) {
    val job = find(id, text, speaker) ?: Utterance(id, text, speaker)
    synchronized(job.lock) {
      if (job.ended || job.cancelled || job.playing != null) {
        promise.resolve(false)
        return
      }
      job.playing = promise
      job.tuning = tuning
      job.lock.notifyAll()
    }
    Log.i(TAG, "Playback requested")
    start(ctx, job)
  }

  private fun find(id: String, text: String, speaker: String): Utterance? = synchronized(jobs) {
    jobs[id]?.takeIf { it.text == text && it.speaker == speaker }
  }

  private fun start(ctx: Context, job: Utterance) {
    synchronized(jobs) {
      if (jobs[job.id] === job) return
      jobs.remove(job.id)?.cancel()
      jobs[job.id] = job
      worker.execute { synthesize(ctx, job) }
    }
  }

  fun stop() {
    val cancelled = synchronized(jobs) { jobs.values.toList().also { jobs.clear() } }
    cancelled.forEach { it.cancel() }
  }

  fun release() {
    stop()
    warming = false
    worker.execute { closeEngine() }
  }

  fun shutdown() {
    release()
    worker.shutdown()
    player.shutdown()
  }

  private fun closeEngine() {
    if (engine != 0L) NyvemiQwenNative.release(engine)
    engine = 0
  }

  private fun load(ctx: Context): Long {
    if (engine != 0L) return engine
    val memory = ActivityManager.MemoryInfo()
    ctx.getSystemService(ActivityManager::class.java).getMemoryInfo(memory)
    check(!memory.lowMemory && memory.availMem >= 900L * 1024 * 1024) { "qwen_memory_unavailable" }
    val started = SystemClock.elapsedRealtime()
    engine = if (NyvemiQwenPack.installed(ctx)) {
      NyvemiQwenNative.load(NyvemiQwenPack.model(ctx).absolutePath.toByteArray(), 0, 0)
    } else ctx.assets.openFd(NyvemiQwenPack.ASSET).use {
      check(it.length == NyvemiQwenPack.MODEL_BYTES)
      NyvemiQwenNative.load(ctx.applicationInfo.sourceDir.toByteArray(), it.startOffset, it.length)
    }
    check(engine != 0L) { "qwen_load_failed" }
    Log.i(TAG, "Model warm in ${SystemClock.elapsedRealtime() - started}ms")
    return engine
  }

  private fun synthesize(ctx: Context, job: Utterance) {
    val started = SystemClock.elapsedRealtime()
    val audio = ArrayList<ShortArray>()
    var sampleCount = 0
    try {
      if (synchronized(job.lock) { job.cancelled }) {
        finish(job)
        return
      }
      val handle = load(ctx)
      val complete = NyvemiQwenNative.generate(
        handle, job.text.toByteArray(), job.speaker.toByteArray(), language(job.text).toByteArray(),
      ) { samples ->
        if (synchronized(job.lock) { job.cancelled }) return@generate false
        val offset = if (audio.isEmpty()) firstAudible(samples) else 0
        if (offset >= 0) {
          val chunk = if (offset == 0) samples else samples.copyOfRange(offset, samples.size)
          audio.add(chunk)
          sampleCount += chunk.size
        }
        true
      }
      if (!complete || audio.isEmpty()) {
        if (synchronized(job.lock) { job.cancelled }) finish(job)
        else finish(job, IllegalStateException("qwen_synthesis_failed"))
        return
      }
      val cancelled = synchronized(job.lock) {
        if (!job.cancelled) {
          job.ready = true
          job.preparing?.resolve(true)
          job.preparing = null
        }
        job.cancelled
      }
      if (cancelled) {
        finish(job)
        return
      }
      Log.i(TAG, "Speech synthesized in ${SystemClock.elapsedRealtime() - started}ms, audio ${sampleCount * 1000L / SAMPLE_RATE}ms")
      player.execute { playBuffered(job, audio, started) }
    } catch (e: Exception) {
      finish(job, e)
    }
  }

  private fun playBuffered(job: Utterance, audio: List<ShortArray>, started: Long) {
    var track: AudioTrack? = null
    var error: Exception? = null
    var completed = false
    var startedPlaying = false
    try {
      val tuning = awaitPlayback(job) ?: return
      val output = newTrack(tuning)
      track = output
      synchronized(job.lock) {
        if (job.cancelled) return
        job.output = output
      }
      var written = 0
      fun write(samples: ShortArray, start: Int = 0, end: Int = samples.size): Boolean {
        var offset = start
        while (offset < end && synchronized(job.lock) { !job.cancelled }) {
          val count = output.write(samples, offset, end - offset, AudioTrack.WRITE_BLOCKING)
          check(count > 0) { "qwen_audio_write_failed" }
          offset += count
          written += count
        }
        return synchronized(job.lock) { !job.cancelled }
      }
      // Keep the first 160 ms ready without filling the smallest track buffer.
      var chunkIndex = 0
      var chunkOffset = 0
      var prefillRemaining = SAMPLE_RATE * 160 / 1000
      while (chunkIndex < audio.size && prefillRemaining > 0) {
        val chunk = audio[chunkIndex]
        val count = minOf(chunk.size - chunkOffset, prefillRemaining)
        if (!write(chunk, chunkOffset, chunkOffset + count)) return
        prefillRemaining -= count
        chunkOffset += count
        if (chunkOffset == chunk.size) {
          chunkIndex++
          chunkOffset = 0
        }
      }
      synchronized(job.lock) {
        if (job.cancelled) return
        output.play()
        startedPlaying = true
      }
      Log.i(TAG, "Playback started ${SystemClock.elapsedRealtime() - started}ms after synthesis began (rate=${tuning.rate}, pitch=${tuning.pitch}, volume=${tuning.volume})")
      while (chunkIndex < audio.size) {
        if (!write(audio[chunkIndex], chunkOffset)) return
        chunkIndex++
        chunkOffset = 0
      }
      Log.i(TAG, "All audio queued with ${output.underrunCount} underruns")
      val remainingFrames = (written - output.playbackHeadPosition).coerceAtLeast(0)
      val drainTime = (remainingFrames * 1000.0 / (SAMPLE_RATE * tuning.rate)).toLong() + 2000
      val drainUntil = SystemClock.elapsedRealtime() + drainTime
      while (output.playbackHeadPosition < written &&
        synchronized(job.lock) { !job.cancelled } && SystemClock.elapsedRealtime() < drainUntil) {
        SystemClock.sleep(15)
      }
      completed = synchronized(job.lock) { !job.cancelled } && output.playbackHeadPosition >= written
      Log.i(TAG, "Playback ${if (completed) "finished" else "stopped"} with ${output.underrunCount} underruns")
    } catch (e: Exception) {
      if (!startedPlaying) error = e
    } finally {
      synchronized(job.lock) {
        job.output = null
        track?.release()
      }
      finish(job, error, completed)
    }
  }

  private fun finish(job: Utterance, error: Exception? = null, completed: Boolean = false) {
    synchronized(job.lock) {
      job.ended = true
      job.preparing?.resolve(false)
      job.preparing = null
      if (error != null && !job.cancelled) {
        job.playing?.reject("qwen_voice_failed", error.message, null)
      } else {
        job.playing?.resolve(!job.cancelled && completed)
      }
      job.playing = null
    }
    synchronized(jobs) { if (jobs[job.id] === job) jobs.remove(job.id) }
  }

  private fun awaitPlayback(job: Utterance): Tuning? = synchronized(job.lock) {
    if (job.cancelled) return null
    val until = SystemClock.elapsedRealtime() + 15000
    while (job.playing == null && !job.cancelled) {
      val remaining = until - SystemClock.elapsedRealtime()
      if (remaining <= 0) return null
      job.lock.wait(remaining)
    }
    if (job.cancelled) null else job.tuning
  }

  private fun language(text: String): String {
    // Kana and Hangul disambiguate mixed text that also contains Han characters.
    var han = false
    for (codePoint in text.codePoints().toArray()) {
      when (Character.UnicodeScript.of(codePoint)) {
        Character.UnicodeScript.HAN -> han = true
        Character.UnicodeScript.HIRAGANA, Character.UnicodeScript.KATAKANA -> return "ja"
        Character.UnicodeScript.HANGUL -> return "ko"
        else -> Unit
      }
    }
    return if (han) "zh" else "auto"
  }

  private fun firstAudible(samples: ShortArray): Int {
    val window = SAMPLE_RATE / 100
    for (offset in 0..(samples.size - window) step window) {
      var energy = 0L
      for (index in offset until offset + window) {
        val sample = samples[index].toLong()
        energy += sample * sample
      }
      if (energy >= window * 327L * 327L) return (offset - window * 3).coerceAtLeast(0)
    }
    return -1
  }

  private fun newTrack(tuning: Tuning): AudioTrack {
    val size = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    check(size > 0) { "qwen_audio_unavailable" }
    val tunedBuffer = kotlin.math.ceil(size / 2.0 * maxOf(1.0, tuning.rate)).toInt() * 2 + 2
    val track = AudioTrack.Builder()
      .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
        .setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
      .setTransferMode(AudioTrack.MODE_STREAM)
      .setBufferSizeInBytes(maxOf(tunedBuffer, SAMPLE_RATE / 2))
      .build()
    try {
      check(track.state == AudioTrack.STATE_INITIALIZED) { "qwen_audio_unavailable" }
      if (tuning.rate != 1.0 || tuning.pitch != 1.0) {
        track.playbackParams = PlaybackParams().allowDefaults()
          .setSpeed(tuning.rate.toFloat()).setPitch(tuning.pitch.toFloat())
      }
      if (tuning.volume != 1.0) {
        check(track.setVolume(tuning.volume.toFloat()) == AudioTrack.SUCCESS) { "qwen_audio_volume_failed" }
      }
      if (android.os.Build.VERSION.SDK_INT >= 31) track.startThresholdInFrames = SAMPLE_RATE / 25
      return track
    } catch (e: Exception) {
      track.release()
      throw e
    }
  }

  companion object {
    private const val TAG = "NyvemiQwen"
    private const val SAMPLE_RATE = 24000
  }
}
