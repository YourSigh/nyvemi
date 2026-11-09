package app.nyvemi.nativebridge

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import expo.modules.kotlin.Promise
import org.json.JSONArray
import java.io.File
import java.util.concurrent.Executors

internal class NyvemiBundledSpeech {
  private data class Voice(val sid: Int, val label: String, val expanded: Boolean) {
    val id get() = "kokoro:$sid"
  }
  private class Playback(val promise: Promise) {
    @Volatile var cancelled = false
    var player: MediaPlayer? = null
    var audioFile: File? = null
  }

  private val handler = Handler(Looper.getMainLooper())
  private val worker = Executors.newSingleThreadExecutor()
  private var engine: OfflineTts? = null // accessed only on worker
  private var engineExpanded = false // accessed only on worker
  private var playback: Playback? = null
  private var catalog: List<Voice>? = null

  private fun voices(context: Context): List<Voice> = catalog ?: (
    readCatalog(context, "catalog.json", false) + readCatalog(context, "expanded-catalog.json", true)
  ).also { catalog = it }

  private fun readCatalog(context: Context, path: String, expanded: Boolean) =
    context.assets.open("$ASSETS/$path").bufferedReader().use { reader ->
      val entries = JSONArray(reader.readText())
      List(entries.length()) { index ->
        val voice = entries.getJSONObject(index)
        Voice(voice.getInt("sid"), voice.getString("name"), expanded)
      }
    }

  fun state(context: Context, promise: Promise) {
    val expanded = NyvemiVoicePack.installed(context)
    val list = voices(context).filter { expanded || !it.expanded }
    promise.resolve(mapOf(
      "available" to list.isNotEmpty(),
      "preferred" to list.firstOrNull()?.id,
      "expanded" to expanded,
      "voices" to list.map { mapOf("id" to it.id, "label" to it.label) },
    ))
  }

  fun speak(context: Context, text: String, voiceId: String?, rate: Double, promise: Promise) {
    require(text.isNotBlank() && text.length <= 240 && rate.isFinite() && rate in 0.65..1.3)
    val voices = voices(context)
    val voice = if (voiceId == null) voices.first() else voices.firstOrNull { it.id == voiceId }
    if (voice == null || (voice.expanded && !NyvemiVoicePack.installed(context))) {
      promise.reject("tts_voice_unavailable", "这个音色还不可用", null)
      return
    }
    stop()
    val request = Playback(promise)
    playback = request
    val app = context.applicationContext
    worker.execute {
      if (request.cancelled) return@execute
      var file: File? = null
      try {
        if (voice.expanded && !engineExpanded) {
          engine?.release()
          engine = null
        }
        val tts = engine ?: createEngine(app, voice.expanded).also {
          engine = it
          engineExpanded = voice.expanded
        }
        if (request.cancelled) return@execute
        val start = android.os.SystemClock.elapsedRealtime()
        val audio = tts.generate(text, voice.sid, rate.toFloat())
        if (request.cancelled) return@execute
        val samples = audio.samples
        check(samples.isNotEmpty() && samples.all { it.isFinite() })
        check(samples.any { kotlin.math.abs(it) > 0.005f })
        check(samples.count { kotlin.math.abs(it) >= 0.99f } < samples.size / 10)
        val wav = File.createTempFile("nyvemi-tts-", ".wav", app.cacheDir)
        file = wav
        check(audio.save(wav.absolutePath))
        val elapsed = android.os.SystemClock.elapsedRealtime() - start
        handler.post {
          if (playback !== request) wav.delete()
          else play(request, wav, voice.id, elapsed, samples.size * 1000L / audio.sampleRate)
        }
      } catch (error: Exception) {
        file?.delete()
        handler.post { fail(request) }
      } catch (error: LinkageError) {
        file?.delete()
        handler.post { fail(request) }
      }
    }
  }

  private fun createEngine(context: Context, expanded: Boolean): OfflineTts {
    val root = if (expanded) NyvemiVoicePack.path(context).absolutePath else ASSETS
    val model = OfflineTtsKokoroModelConfig(
      model = "$root/model.int8.onnx",
      voices = "$root/voices.bin",
      tokens = "$root/tokens.txt",
      lexicon = "$root/lexicon-us-en.txt,$root/lexicon-zh.txt",
    )
    return OfflineTts(
      assetManager = if (expanded) null else context.assets,
      config = OfflineTtsConfig(
        model = OfflineTtsModelConfig(kokoro = model, numThreads = 2),
        ruleFsts = "$root/phone-zh.fst,$root/date-zh.fst,$root/number-zh.fst",
      ),
    )
  }

  private fun play(request: Playback, file: File, voiceId: String, elapsed: Long, duration: Long) {
    request.audioFile = file
    try {
      val player = MediaPlayer()
      request.player = player
      player.setAudioAttributes(AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      player.setDataSource(file.absolutePath)
      player.setOnPreparedListener {
        if (playback !== request) return@setOnPreparedListener
        try {
          it.start()
          Log.i(TAG, "playing $voiceId synthesized=${elapsed}ms audio=${duration}ms")
        } catch (_: IllegalStateException) {
          fail(request)
        }
      }
      player.setOnCompletionListener {
        if (playback === request) {
          stopPlayback(request)
          request.promise.resolve(true)
        }
      }
      player.setOnErrorListener { _, _, _ -> fail(request); true }
      player.prepareAsync()
    } catch (_: Exception) {
      fail(request)
    }
  }

  private fun fail(request: Playback) {
    if (playback !== request) return
    stopPlayback(request)
    request.promise.reject("tts_playback_failed", "内置语音暂时无法播放", null)
  }

  private fun stopPlayback(request: Playback) {
    playback = null
    request.cancelled = true
    request.player?.release()
    request.audioFile?.delete()
  }

  fun stop() {
    val request = playback ?: return
    stopPlayback(request)
    request.promise.resolve(false)
  }

  fun shutdown() {
    stop()
    worker.execute { engine?.release(); engine = null }
    worker.shutdown()
  }

  companion object {
    private const val ASSETS = "nyvemi-tts"
    private const val TAG = "NyvemiBundledSpeech"
    fun handles(voiceId: String?) = voiceId == null || voiceId.startsWith("kokoro:")
  }
}
