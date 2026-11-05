package app.nyvemi.nativebridge

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise

/** Only installed, embedded Chinese voices. Never falls back to network synthesis. */
class NyvemiSpeechOutput {
  private val handler = Handler(Looper.getMainLooper())
  private var engine: TextToSpeech? = null
  private var ready = false
  private var generation = 0
  private var playGeneration = 0
  private val waiters = mutableListOf<(TextToSpeech?) -> Unit>()
  private var initTimer: Runnable? = null
  private var current: Pair<String, Promise>? = null
  private var speechTimer: Runnable? = null
  private fun withEngine(ctx: Context, action: (TextToSpeech?) -> Unit) {
    if (ready) { action(engine); return }
    waiters.add(action)
    if (engine != null) return
    val token = ++generation
    initTimer = Runnable { if (token == generation && !ready) shutdown() }
    handler.postDelayed(initTimer!!, 10000)
    try {
      engine = TextToSpeech(ctx.applicationContext) { status -> handler.post {
        if (token != generation) return@post
        initTimer?.let { handler.removeCallbacks(it) }; initTimer = null
        ready = status == TextToSpeech.SUCCESS
        engine?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(id: String?) = Unit
          override fun onDone(id: String?) { handler.post { complete(id, true) } }
          @Deprecated("Deprecated in Java") override fun onError(id: String?) { handler.post { fail(id) } }
          override fun onError(id: String?, code: Int) { handler.post { fail(id) } }
          override fun onStop(id: String?, interrupted: Boolean) { handler.post { complete(id, false) } }
        })
        val pending = waiters.toList(); waiters.clear()
        pending.forEach { it(if (ready) engine else null) }
        if (!ready) { engine?.shutdown(); engine = null }
      } }
    } catch (_: Exception) { shutdown() }
  }
  private fun candidates(tts: TextToSpeech) = tts.voices.orEmpty().map {
    NyvemiSpeechPolicy.Candidate(it.name, it.locale.language, it.isNetworkConnectionRequired,
      !it.features.orEmpty().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED), it.quality)
  }
  fun state(ctx: Context, promise: Promise) = withEngine(ctx) { tts ->
    if (tts == null) { promise.resolve(mapOf("available" to false, "voices" to emptyList<Any>())); return@withEngine }
    val voices = candidates(tts).filter { !it.network && it.installed && it.language in listOf("zh", "zho") }.sortedBy { it.id }
    val preferred = NyvemiSpeechPolicy.choose(voices, null, tts.defaultVoice?.name)
    promise.resolve(mapOf("available" to voices.isNotEmpty(), "preferred" to preferred,
      "voices" to voices.mapIndexed { index, voice -> mapOf("id" to voice.id, "label" to "中文音色 ${index + 1}") }))
  }
  fun speak(ctx: Context, id: String, text: String, voiceId: String?, rate: Double, pitch: Double, promise: Promise) {
    require(text.isNotBlank() && text.length <= 3500 && id.length <= 180)
    require(rate.isFinite() && rate in 0.65..1.3 && pitch.isFinite() && pitch in 0.7..1.4)
    val playToken = ++playGeneration
    var warmupAttempts = 0
    lateinit var attempt: (TextToSpeech?) -> Unit
    attempt = attempt@ { tts ->
      if(playToken != playGeneration) { promise.resolve(false); return@attempt }
      if (tts == null) { promise.reject("tts_unavailable", "手机还没有可用的本地语音引擎", null); return@attempt }
      val selected = NyvemiSpeechPolicy.choose(candidates(tts), voiceId, tts.defaultVoice?.name)
      val voice = tts.voices.orEmpty().firstOrNull { it.name == selected }
      if (voice == null && warmupAttempts++ < 2) {
        handler.postDelayed({ attempt(tts) }, 650)
        return@attempt
      }
      if (voice == null) { promise.reject("tts_data_missing", "请先安装中文离线音色", null); return@attempt }
      stop()
      if (tts.setVoice(voice) != TextToSpeech.SUCCESS) { promise.reject("tts_voice_unavailable", "这个本机音色暂不可用，请换一个", null); return@attempt }
      tts.setSpeechRate(rate.toFloat()); tts.setPitch(pitch.toFloat())
      tts.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      val utteranceId = "$id:$playToken"
      current = utteranceId to promise
      speechTimer = Runnable { fail(utteranceId) }; handler.postDelayed(speechTimer!!, minOf(180000L, maxOf(20000L, text.length * 500L)))
      if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId) != TextToSpeech.SUCCESS) fail(utteranceId)
    }
    withEngine(ctx,attempt)
  }
  private fun complete(id: String?, result: Boolean) {
    val active = current ?: return
    if (id != active.first) return
    current = null; speechTimer?.let { handler.removeCallbacks(it) }; speechTimer = null
    active.second.resolve(result)
  }
  private fun fail(id: String?) {
    val active = current ?: return
    if (id != active.first) return
    current = null; speechTimer?.let { handler.removeCallbacks(it) }; speechTimer = null
    engine?.stop(); active.second.reject("tts_playback_failed", "本机声音没能播放，请在声音设置中试听", null)
  }
  fun stop() { playGeneration++; complete(current?.first, false); engine?.stop() }
  fun shutdown() {
    generation++; stop(); ready = false
    initTimer?.let { handler.removeCallbacks(it) }; initTimer = null
    engine?.shutdown(); engine = null
    val pending = waiters.toList(); waiters.clear(); pending.forEach { it(null) }
  }
  fun install(ctx: Context) {
    val specific = Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    engine?.defaultEngine?.let { specific.setPackage(it) }
    try { ctx.startActivity(specific) } catch (_: Exception) {
      try { ctx.startActivity(Intent("com.android.settings.TTS_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
      catch (_: Exception) { ctx.startActivity(Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
  }
}
