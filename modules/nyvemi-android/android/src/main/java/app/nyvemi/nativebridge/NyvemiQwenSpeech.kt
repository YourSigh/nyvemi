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

  private class Utterance(val id: String, val text: String, val speaker: String, val rate: Double) {
    val lock = Object()
    var preparing: Promise? = null
    var playing: Promise? = null
    var tuning: Tuning? = null
    val audio = ArrayDeque<ShortArray>()
    var queuedFrames = 0
    var playbackScheduled = false
    var synthesisStartedAt = 0L
    var ready = false
    var synthesisEnded = false
    var synthesisError: Exception? = null
    var cancelled = false
    var ended = false
    var output: AudioTrack? = null

    fun cancel() = synchronized(lock) {
      cancelled = true
      audio.clear()
      queuedFrames = 0
      output?.pause()
      output?.flush()
      preparing?.resolve(false)
      preparing = null
      playing?.resolve(false)
      playing = null
    }
  }

  private val expiry = Executors.newSingleThreadScheduledExecutor()
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

  fun prepare(ctx: Context, id: String, text: String, speaker: String, rate: Double, promise: Promise) {
    val job = find(id, text, speaker) ?: Utterance(id, text, speaker, rate)
    synchronized(job.lock) {
      if (job.ready || job.ended || job.cancelled) {
        promise.resolve(job.ready && !job.cancelled)
      } else {
        job.preparing?.resolve(false)
        job.preparing = promise
      }
    }
    start(ctx, job)
  }

  fun play(ctx: Context, id: String, text: String, speaker: String, tuning: Tuning, promise: Promise) {
    val job = find(id, text, speaker) ?: Utterance(id, text, speaker, tuning.rate)
    synchronized(job.lock) {
      if (job.ended || job.cancelled || job.playing != null) {
        promise.resolve(false)
        return
      }
      job.playing = promise
      job.tuning = tuning
      schedulePlayback(job)
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
    expiry.shutdownNow()
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
    synchronized(job.lock) { job.synthesisStartedAt = started }
    var firstAudioAt = 0L
    var sampleCount = 0
    var failure: Exception? = null
    val estimatedAudioMs = job.text.codePoints().toArray().fold(0) { total, codePoint ->
      total + when {
        Character.UnicodeScript.of(codePoint) == Character.UnicodeScript.HAN -> 270
        Character.isLetterOrDigit(codePoint) -> 85
        else -> 40
      }
    }.coerceAtLeast(900)

    try {
      if (synchronized(job.lock) { job.cancelled }) return
      val handle = load(ctx)
      val complete = NyvemiQwenNative.generate(
        handle, job.text.toByteArray(), job.speaker.toByteArray(), language(job.text).toByteArray(),
      ) { samples ->
        synchronized(job.lock) {
          if (job.cancelled || job.ended) return@generate false
          val offset = if (sampleCount == 0) firstAudible(samples) else 0
          if (offset < 0) return@generate true
          val now = SystemClock.elapsedRealtime()
          if (sampleCount == 0) firstAudioAt = now
          val chunk = if (offset == 0) samples else samples.copyOfRange(offset, samples.size)
          job.audio.addLast(chunk)
          job.queuedFrames += chunk.size
          sampleCount += chunk.size
          val audioMs = sampleCount * 1000L / SAMPLE_RATE
          if (!job.ready && shouldStartSpeech(audioMs, now - firstAudioAt, estimatedAudioMs, job.rate)) {
            markReady(job)
          }
          true
        }
      }
      if (!complete || sampleCount == 0) failure = IllegalStateException("qwen_synthesis_failed")
    } catch (e: Exception) {
      failure = e
    } finally {
      synchronized(job.lock) {
        job.synthesisError = failure
        job.synthesisEnded = true
        if (!job.cancelled && failure == null) markReady(job)
      }
      if (sampleCount > 0) Log.i(TAG, "Speech synthesized in ${SystemClock.elapsedRealtime() - started}ms, audio ${sampleCount * 1000L / SAMPLE_RATE}ms")
      if (failure != null && !synchronized(job.lock) { job.playbackScheduled }) finish(job, failure)
    }
  }

  // Called with job.lock held. Prepared audio never reserves the player before its bubble is visible.
  private fun markReady(job: Utterance) {
    if (job.ready) return
    job.ready = true
    expiry.schedule({ expireDraft(job) }, 30, java.util.concurrent.TimeUnit.SECONDS)
    job.preparing?.resolve(true)
    job.preparing = null
    schedulePlayback(job)
  }

  private fun expireDraft(job: Utterance) = synchronized(jobs) {
    if (jobs[job.id] === job) {
      synchronized(job.lock) {
        if (job.playing == null) {
          jobs.remove(job.id)
          job.cancel()
        }
      }
    }
  }

  private fun schedulePlayback(job: Utterance) {
    if (!job.ready || job.playing == null || job.playbackScheduled) return
    val tuning = checkNotNull(job.tuning)
    job.playbackScheduled = true
    player.execute { playBuffered(job, tuning, job.synthesisStartedAt) }
  }

  private fun playBuffered(job: Utterance, tuning: Tuning, started: Long) {
    var track: AudioTrack? = null
    var error: Exception? = null
    var completed = false
    var everStarted = false
    try {
      val output = newTrack(tuning)
      track = output
      synchronized(job.lock) {
        if (job.cancelled) return
        job.output = output
      }
      var written = 0
      var chunk = ShortArray(0)
      var offset = 0
      var playing = false
      var rebuffers = 0
      var drainUntil = Long.MAX_VALUE
      val lowWaterFrames = (SAMPLE_RATE * 0.11 * tuning.rate).toInt()
      while (true) {
        val (ended, available) = synchronized(job.lock) {
          if (job.cancelled) return
          if (offset == chunk.size) {
            job.audio.removeFirstOrNull()?.let {
              chunk = it
              offset = 0
              job.queuedFrames -= it.size
            }
          }
          job.synthesisEnded to job.queuedFrames
        }
        val inTrack = (written - output.playbackHeadPosition).coerceAtLeast(0)
        val remaining = chunk.size - offset
        if (ended && available == 0 && remaining == 0) {
          val failure = synchronized(job.lock) { job.synthesisError }
          if (!everStarted && failure != null) throw failure
          if (inTrack == 0) {
            completed = failure == null
            break
          }
          val now = SystemClock.elapsedRealtime()
          if (drainUntil == Long.MAX_VALUE) {
            drainUntil = now + (inTrack * 1000.0 / (SAMPLE_RATE * tuning.rate)).toLong() + 2000
          } else if (now >= drainUntil) {
            break
          }
        }

        val count = if (remaining > 0) {
          output.write(chunk, offset, remaining, AudioTrack.WRITE_NON_BLOCKING)
        } else 0
        check(count >= 0) { "qwen_audio_write_failed" }
        written += count
        offset += count
        val readyFrames = inTrack + count
        val reserveMs = if (everStarted) (1650 + (rebuffers - 1) * 550).coerceAtMost(3300) else 160
        val reserve = (SAMPLE_RATE * tuning.rate * reserveMs / 1000).toInt()
        val hasReserve = readyFrames + available + remaining - count >= reserve
        val hasTrackAudio = readyFrames >= SAMPLE_RATE / 25 || (ended && readyFrames > 0)
        if (!playing && hasTrackAudio && (hasReserve || ended)) {
          if (ended && readyFrames < SAMPLE_RATE / 25 && android.os.Build.VERSION.SDK_INT >= 31) {
            output.startThresholdInFrames = readyFrames
          }
          synchronized(job.lock) {
            if (job.cancelled) return
            output.play()
          }
          playing = true
          if (!everStarted) {
            Log.i(TAG, "Playback started ${SystemClock.elapsedRealtime() - started}ms after synthesis began")
            everStarted = true
          }
        } else if (playing && !ended && readyFrames <= lowWaterFrames && available == 0 && offset == chunk.size) {
          synchronized(job.lock) {
            if (job.cancelled) return
            output.pause()
          }
          playing = false
          rebuffers++
        }
        if (count == 0) SystemClock.sleep(10)
      }
      Log.i(TAG, "Playback ${if (completed) "finished" else "stopped"} with $rebuffers rebuffer pauses, ${output.underrunCount} underruns")
    } catch (e: Exception) {
      if (!everStarted) error = e
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
      job.audio.clear()
      job.queuedFrames = 0
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
