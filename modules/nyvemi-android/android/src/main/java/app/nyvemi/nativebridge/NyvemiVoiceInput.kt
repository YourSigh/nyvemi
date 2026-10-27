package app.nyvemi.nativebridge

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise

/** System recognition only. No audio files, app server or transcript logging. */
class NyvemiVoiceInput(private val partial: (String, String) -> Unit) {
  private val handler = Handler(Looper.getMainLooper())
  private class Session(val id: String) {
    var recognizer: SpeechRecognizer? = null
    var text: String? = null
    var ready = false
    var error: String? = null
    var released = false
    var promise: Promise? = null
    var timeout: Runnable? = null
  }
  private var current: Session? = null

  fun start(context: Context, id: String) {
    if (current != null) throw IllegalStateException("上一段语音仍在处理")
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
      throw SecurityException("请允许麦克风权限后再试")
    if (!SpeechRecognizer.isRecognitionAvailable(context)) throw IllegalStateException("设备没有可用的语音识别服务，可切回键盘输入")
    val s = Session(id)
    current = s
    try {
      val recognizer = SpeechRecognizer.createSpeechRecognizer(context)
      s.recognizer = recognizer
      recognizer.setRecognitionListener(object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
        override fun onPartialResults(results: Bundle?) {
          if (current !== s || s.released || s.ready) return
          val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.take(6000).orEmpty()
          partial(s.id, text)
        }
        override fun onResults(results: Bundle?) {
          if (current !== s || s.ready) return
          s.text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim()?.take(6000)
          s.ready = true
          if (s.released) complete(s)
        }
        override fun onError(error: Int) {
          if (current !== s || s.ready) return
          s.error = when (error) {
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "麦克风权限未开启"
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "系统语音识别网络不可用，请重试"
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "系统语音识别正忙，请重试"
            else -> "没有听清，请再说一次"
          }
          s.ready = true
          if (s.released) complete(s)
        }
      })
      recognizer.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, java.util.Locale.getDefault().toLanguageTag())
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      })
      s.timeout = Runnable { if (current === s) cancel(id) }
      handler.postDelayed(s.timeout!!, 75000)
    } catch (error: Exception) { cancel(id); throw error }
  }

  fun finish(id: String, cancel: Boolean, promise: Promise) {
    val s = current
    if (s == null || s.id != id) { promise.resolve(null); return }
    if (cancel) { cancel(id); promise.resolve(null); return }
    if (s.released) { promise.reject("voice_busy", "语音正在识别", null); return }
    s.promise = promise
    s.released = true
    s.timeout?.let { handler.removeCallbacks(it) }
    if (s.ready) { complete(s); return }
    s.timeout = Runnable {
      if (current === s) { s.error = "语音识别超时，请重试"; s.ready = true; complete(s) }
    }
    handler.postDelayed(s.timeout!!, 8000)
    try { s.recognizer?.stopListening() }
    catch (_: Exception) { s.error = "无法完成语音识别，请重试"; complete(s) }
  }

  private fun complete(s: Session) {
    if (current !== s) return
    current = null
    s.timeout?.let { handler.removeCallbacks(it) }
    s.recognizer?.destroy()
    val promise = s.promise; s.promise = null
    if (s.error != null) promise?.reject("voice_failed", s.error, null)
    else promise?.resolve(s.text?.takeIf { it.isNotBlank() })
  }

  fun cancel(id: String? = null) {
    if (Looper.myLooper() != Looper.getMainLooper()) { handler.post { cancel(id) }; return }
    val s = current ?: return
    if (id != null && s.id != id) return
    current = null
    s.timeout?.let { handler.removeCallbacks(it) }
    try { s.recognizer?.cancel(); s.recognizer?.destroy() } catch (_: Exception) {}
    s.promise?.resolve(null); s.promise = null
  }
}
