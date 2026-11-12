package app.nyvemi.nativebridge

import android.app.ActivityManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.SystemClock
import android.util.Log
import expo.modules.kotlin.Promise
import java.io.IOException
import java.util.concurrent.Executors

internal class NyvemiQwenSpeech {
  private class Utterance(val id: String, val text: String, val speaker: String) {
    val lock = Object()
    var preparing: Promise? = null
    var playing: Promise? = null
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
  private val jobs = LinkedHashMap<String, Utterance>()
  private var engine = 0L // Owned by worker.
  private var warming = false

  fun available(ctx: Context): Boolean {
    if (!NyvemiQwenNative.available) return false
    return try {
      ctx.assets.openFd(MODEL).use { it.length == MODEL_BYTES }
    } catch (_: IOException) {
      false
    }
  }

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

  fun play(ctx: Context, id: String, text: String, speaker: String, promise: Promise) {
    val job = find(id, text, speaker) ?: Utterance(id, text, speaker)
    synchronized(job.lock) {
      if (job.ended || job.cancelled || job.playing != null) {
        promise.resolve(false)
        return
      }
      job.playing = promise
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
      // A second bubble can start preparing before React has observed the first.
      val pending = jobs.values.filter { synchronized(it.lock) { it.playing == null } }
      for (stale in pending.take((pending.size - 2).coerceAtLeast(0))) {
        jobs.remove(stale.id)
        stale.cancel()
      }
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
    engine = ctx.assets.openFd(MODEL).use {
      check(it.length == MODEL_BYTES)
      NyvemiQwenNative.load(ctx.applicationInfo.sourceDir.toByteArray(), it.startOffset, it.length)
    }
    check(engine != 0L) { "qwen_load_failed" }
    Log.i(TAG, "Model warm in ${SystemClock.elapsedRealtime() - started}ms")
    return engine
  }

  private fun synthesize(ctx: Context, job: Utterance) {
    var track: AudioTrack? = null
    var written = 0
    var error: Exception? = null
    var complete = false
    val started = SystemClock.elapsedRealtime()
    val preRoll = ArrayList<ShortArray>()
    var buffered = 0
    fun write(samples: ShortArray): Boolean {
      var offset = 0
      while (offset < samples.size && synchronized(job.lock) { !job.cancelled }) {
        val count = track!!.write(samples, offset, samples.size - offset, AudioTrack.WRITE_BLOCKING)
        check(count > 0) { "qwen_audio_write_failed" }
        offset += count
        written += count
      }
      return synchronized(job.lock) { !job.cancelled }
    }
    fun beginPlayback(): Boolean {
      if (!awaitPlayback(job, started)) return false
      val output = newTrack()
      track = output
      synchronized(job.lock) {
        if (job.cancelled) return false
        job.output = output
      }
      // Queue the first audio before starting the sink, even when the player is cold.
      if (!write(preRoll.first())) return false
      synchronized(job.lock) {
        if (job.cancelled) return false
        output.play()
      }
      Log.i(TAG, "Playback started ${SystemClock.elapsedRealtime() - started}ms after synthesis began")
      return preRoll.drop(1).all { write(it) }
    }
    try {
      if (synchronized(job.lock) { job.cancelled }) return
      val handle = load(ctx)
      complete = NyvemiQwenNative.generate(
        handle, job.text.toByteArray(), job.speaker.toByteArray(), language(job.text).toByteArray(),
      ) { samples ->
        if (synchronized(job.lock) { job.cancelled }) return@generate false
        if (track != null) return@generate write(samples)
        val offset = if (preRoll.isEmpty()) firstAudible(samples) else 0
        if (offset < 0) return@generate true
        preRoll.add(if (offset == 0) samples else samples.copyOfRange(offset, samples.size))
        buffered += samples.size - offset
        buffered < SAMPLE_RATE / 7 || beginPlayback()
      }
      if (track == null && complete && preRoll.isNotEmpty()) complete = beginPlayback()
      if (track == null && synchronized(job.lock) { !job.cancelled }) {
        error = IllegalStateException("qwen_no_audible_audio")
      }
      val drainUntil = SystemClock.elapsedRealtime() + 2000
      while (track != null && track!!.playbackHeadPosition < written &&
        synchronized(job.lock) { !job.cancelled } && SystemClock.elapsedRealtime() < drainUntil) {
        SystemClock.sleep(15)
      }
    } catch (e: Exception) {
      error = e
    } finally {
      synchronized(job.lock) {
        job.output = null
        track?.release()
        job.ended = true
        job.preparing?.resolve(false)
        job.preparing = null
        if (error != null && written == 0 && !job.cancelled) {
          job.playing?.reject("qwen_voice_failed", error.message, null)
        } else {
          job.playing?.resolve(!job.cancelled && (complete || written > 0))
        }
        job.playing = null
      }
      synchronized(jobs) { if (jobs[job.id] === job) jobs.remove(job.id) }
    }
  }

  private fun awaitPlayback(job: Utterance, started: Long): Boolean = synchronized(job.lock) {
    if (job.cancelled) return false
    job.ready = true
    Log.i(TAG, "Speech ready in ${SystemClock.elapsedRealtime() - started}ms")
    job.preparing?.resolve(true)
    job.preparing = null
    val until = SystemClock.elapsedRealtime() + 15000
    while (job.playing == null && !job.cancelled) {
      val remaining = until - SystemClock.elapsedRealtime()
      if (remaining <= 0) return false
      job.lock.wait(remaining)
    }
    !job.cancelled
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

  private fun newTrack(): AudioTrack {
    val size = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    check(size > 0) { "qwen_audio_unavailable" }
    val track = AudioTrack.Builder()
      .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
        .setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
      .setTransferMode(AudioTrack.MODE_STREAM)
      .setBufferSizeInBytes(maxOf(size, SAMPLE_RATE / 2))
      .build()
    if (track.state != AudioTrack.STATE_INITIALIZED) {
      track.release()
      error("qwen_audio_unavailable")
    }
    if (android.os.Build.VERSION.SDK_INT >= 31) track.startThresholdInFrames = SAMPLE_RATE / 25
    return track
  }

  companion object {
    private const val TAG = "NyvemiQwen"
    private const val MODEL = "qwen/customvoice.gguf"
    private const val MODEL_BYTES = 760680704L
    private const val SAMPLE_RATE = 24000
  }
}
