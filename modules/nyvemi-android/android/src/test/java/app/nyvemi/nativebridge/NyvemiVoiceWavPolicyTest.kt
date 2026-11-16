package app.nyvemi.nativebridge

import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class NyvemiVoiceWavPolicyTest {
  private fun wav(): ByteArray = ByteArray(48).also {
    "RIFF".toByteArray().copyInto(it)
    ByteBuffer.wrap(it, 4, 4).order(ByteOrder.LITTLE_ENDIAN).putInt(40)
    "WAVE".toByteArray().copyInto(it, 8)
  }
  private fun rejects(action: () -> Unit) { assertTrue(runCatching(action).isFailure) }
  @Test fun onlyAppCacheFiles() {
    val root = Files.createTempDirectory("voice-policy").toFile()
    try {
      val cache = root.resolve("cache").apply { mkdir() }
      val valid = cache.resolve("voice.wav").apply { writeBytes(wav()) }
      val outside = root.resolve("private.wav").apply { writeBytes(wav()) }
      assertEquals(valid.canonicalFile, NyvemiVoiceWavPolicy.cacheFile(cache, valid.toURI().toString()))
      rejects { NyvemiVoiceWavPolicy.cacheFile(cache, outside.toURI().toString()) }
      rejects { NyvemiVoiceWavPolicy.cacheFile(cache, "https://example.com/audio.wav") }
      rejects { NyvemiVoiceWavPolicy.cacheFile(cache, "content://audio/test") }
      rejects { NyvemiVoiceWavPolicy.cacheFile(cache, valid.toURI().toString() + "?q=1") }
      rejects { NyvemiVoiceWavPolicy.cacheFile(cache, cache.toURI().toString()) }
      rejects { NyvemiVoiceWavPolicy.cacheFile(cache, "file://localhost" + valid.path) }
      val link = cache.resolve("link.wav")
      Files.createSymbolicLink(link.toPath(), outside.toPath())
      rejects { NyvemiVoiceWavPolicy.cacheFile(cache, link.toURI().toString()) }
    } finally { root.deleteRecursively() }
  }
  @Test fun wavHeaderAndSizeAreBounded() {
    val valid = wav()
    NyvemiVoiceWavPolicy.validateHeader(ByteArrayInputStream(valid), valid.size.toLong())
    rejects { NyvemiVoiceWavPolicy.validateHeader(ByteArrayInputStream(valid), NyvemiVoiceWavPolicy.MAX_BYTES + 1) }
    rejects { NyvemiVoiceWavPolicy.validateHeader(ByteArrayInputStream(valid), 47) }
    rejects { NyvemiVoiceWavPolicy.validateHeader(ByteArrayInputStream(byteArrayOf(1)), 48) }
    valid[0] = 0
    rejects { NyvemiVoiceWavPolicy.validateHeader(ByteArrayInputStream(valid), 48) }
  }
}
