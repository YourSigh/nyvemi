package app.nyvemi.nativebridge

import java.io.File
import java.io.InputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/** Bounded transfer engine, independently testable without Android or network access. */
internal class NyvemiLocalVoiceTransfer(private val transport: Transport) {
  interface Transport {
    fun open(url: URI, start: Long, end: Long): Response
    fun cancel()
  }
  class Response(val status: Int, val range: String?, val length: String?, val encoding: String?, val body: InputStream, private val cleanup: () -> Unit = {}) : AutoCloseable {
    override fun close() { try { body.close() } finally { cleanup() } }
  }
  interface Progress {
    fun received(bytes: Long)
    fun verifying()
  }
  private val paused = AtomicBoolean(false)
  fun pause() { paused.set(true); transport.cancel() }
  fun download(part: File, url: URI, size: Long, sha: String, progress: Progress): Boolean {
    require(size in 1..(1024L * 1024 * 1024) && Regex("[0-9a-f]{64}").matches(sha))
    require(part.name.endsWith(".part"))
    if (part.length() > size) { check(part.delete()); throw IOException("模型临时文件大小不符，请重新下载") }
    var offset = part.length()
    progress.received(offset)
    val buffer = ByteArray(65536)
    while (offset < size) {
      if (paused.get()) return false
      val start = offset
      val end = minOf(size - 1, start + 32L * 1024 * 1024 - 1)
      var validHeaders = false
      try {
        transport.open(url, start, end).use { response ->
          check(response.status == 206 && response.range == "bytes $start-$end/$size" && response.length == "${end-start+1}" && (response.encoding == null || response.encoding == "identity")) { "模型服务器未返回准确的分段内容" }
          validHeaders = true
          RandomAccessFile(part, "rw").use { output ->
            output.seek(start)
            var remaining = end-start+1
            while (remaining > 0) {
              if (paused.get()) return false
              val count = response.body.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
              if (count < 0) throw IOException("模型下载中断，可重试")
              if (count == 0) continue
              output.write(buffer, 0, count); offset += count; remaining -= count
              progress.received(offset)
            }
            if (paused.get()) return false
            check(response.body.read() == -1) { "模型分段返回超出预期" }
          }
        }
      } catch (error: Exception) {
        if (paused.get()) return false
        // A failed/truncated range is not trusted. Retain only the earlier complete prefix.
        if (validHeaders && part.exists()) RandomAccessFile(part, "rw").use { it.setLength(start) }
        throw error
      }
    }
    if (paused.get()) return false
    progress.verifying()
    val hash = MessageDigest.getInstance("SHA-256")
    part.inputStream().use { input ->
      while (true) { if (paused.get()) return false; val count = input.read(buffer); if (count < 0) break; hash.update(buffer,0,count) }
    }
    if (paused.get()) return false
    val actual = hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    if (actual != sha) { check(part.delete()); throw IOException("模型校验失败，已丢弃损坏文件，请重新下载") }
    return true
  }
}
