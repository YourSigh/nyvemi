package app.nyvemi.nativebridge

import androidx.annotation.Keep

internal object NyvemiQwenNative {
  val available = loadLibrary()

  private fun loadLibrary(): Boolean {
    val fast = runCatching {
      java.io.File("/proc/cpuinfo").useLines { lines ->
        val features = lines.filter { it.startsWith("Features") }
          .map { it.substringAfter(':').trim().split(Regex("\\s+")).toSet() }.toList()
        features.isNotEmpty() && features.all { "asimddp" in it && "asimdhp" in it && "fphp" in it }
      }
    }.getOrDefault(false)
    for (library in if (fast) listOf("nyvemi_qwen_dotprod", "nyvemi_qwen") else listOf("nyvemi_qwen")) {
      try {
        System.loadLibrary(library)
        return true
      } catch (_: LinkageError) {
        // The basic ARM64 build also runs without dot-product and FP16 instructions.
      }
    }
    return false
  }

  @Keep external fun load(path: ByteArray, offset: Long, length: Long): Long
  @Keep external fun release(handle: Long)
  @Keep external fun generate(handle: Long, text: ByteArray, voice: ByteArray, language: ByteArray, receiver: PcmReceiver): Boolean

  @Keep fun interface PcmReceiver {
    @Keep fun onPcm(samples: ShortArray): Boolean
  }
}
