package app.nyvemi.nativebridge
object NyvemiSpeechPolicy {
  data class Candidate(val id: String, val language: String, val network: Boolean, val installed: Boolean, val quality: Int)
  fun choose(voices: List<Candidate>, requested: String?, defaultId: String?): String? {
    val available = voices.filter { !it.network && it.installed && it.language in listOf("zh", "zho") }
    available.firstOrNull { it.id == requested }?.let { return it.id }
    // Engine names are hints only: Android does not expose a standardized gender field.
    return available.sortedWith(compareByDescending<Candidate> {
      (if (Regex("female|xiaoxiao|xiaoyan|xiaoyi|女", RegexOption.IGNORE_CASE).containsMatchIn(it.id)) 10000 else 0) +
        (if (it.id == defaultId) 1000 else 0) + it.quality
    }.thenBy { it.id }).firstOrNull()?.id
  }
}

internal fun shouldStartSpeech(audioMs: Long, elapsedMs: Long, estimatedAudioMs: Int, rate: Double): Boolean {
  if (audioMs < 720) return false
  // Start sooner when synthesis keeps up. Slower engines need more room for later chunks.
  val synthesisSpeed = audioMs.toDouble() / elapsedMs.coerceAtLeast(1)
  val expectedDeficit = estimatedAudioMs * (1 - synthesisSpeed / rate).coerceAtLeast(0.0)
  return audioMs >= (expectedDeficit + 650).coerceIn(850.0, 4000.0) || elapsedMs >= 4800
}
