package app.nyvemi.nativebridge

import androidx.annotation.Keep

internal object NyvemiQwenNative {
  val available = try {
    System.loadLibrary("nyvemi_qwen")
    true
  } catch (_: LinkageError) {
    false
  }

  @Keep external fun load(path: ByteArray, offset: Long, length: Long): Long
  @Keep external fun release(handle: Long)
  @Keep external fun generate(handle: Long, text: ByteArray, voice: ByteArray, receiver: PcmReceiver, seed: Long): Boolean

  @Keep fun interface PcmReceiver {
    @Keep fun onPcm(samples: ShortArray): Boolean
  }
}
