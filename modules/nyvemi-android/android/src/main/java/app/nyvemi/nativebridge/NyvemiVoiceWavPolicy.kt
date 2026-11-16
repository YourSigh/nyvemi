package app.nyvemi.nativebridge

import java.io.File
import java.io.InputStream
import java.net.URI
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** No network/content URI, arbitrary file, oversized payload or non-WAV decoder input. */
internal object NyvemiVoiceWavPolicy {
  const val MAX_BYTES = 24L * 1024 * 1024
  fun cacheFile(cache: File, value: String): File {
    require(value.length <= 4096)
    val uri = URI(value)
    require(uri.scheme == "file" && uri.rawAuthority.isNullOrEmpty() && uri.rawQuery == null && uri.rawFragment == null)
    val file = File(uri).canonicalFile
    require(file.path.startsWith(cache.canonicalPath + File.separator))
    require(file.isFile && file.length() in 44..MAX_BYTES)
    return file
  }
  fun validateHeader(input: InputStream, length: Long) {
    require(length in 44..MAX_BYTES)
    val header = ByteArray(12)
    var count = 0
    while (count < header.size) {
      val read = input.read(header, count, header.size - count)
      require(read > 0)
      count += read
    }
    require(String(header, 0, 4, Charsets.US_ASCII) == "RIFF" && String(header, 8, 4, Charsets.US_ASCII) == "WAVE")
    val declared = ByteBuffer.wrap(header, 4, 4).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xffffffffL
    require(declared + 8 == length)
  }
}
