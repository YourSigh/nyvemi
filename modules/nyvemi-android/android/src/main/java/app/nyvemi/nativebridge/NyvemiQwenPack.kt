package app.nyvemi.nativebridge

import android.content.Context
import android.net.Uri
import android.util.Log
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

internal object NyvemiQwenPack {
  const val MODEL_BYTES = 760680704L
  const val ASSET = "qwen/customvoice.gguf"
  private const val SHA256 = "67cbe04239d079d3e3649a054258b8cf1553a99a03cc5b38d57350c6905e4cbd"
  private const val PATH = "sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF/resolve/fd9df9364613a92a86b4137074bc281204823033/Qwen3-TTS-12Hz-0.6B-CustomVoice-Q4_K.gguf"
  private const val CHUNK_BYTES = 32L * 1024 * 1024
  private val sources = listOf("hf-mirror.com", "huggingface.co")
  private val worker = Executors.newSingleThreadExecutor()
  @Volatile private var phase: String? = null
  @Volatile private var failure: String? = null
  @Volatile private var pauseRequested = false
  @Volatile private var received = 0L

  private class InvalidModel : IOException()
  private class InsufficientSpace : IOException()

  fun model(ctx: Context) = File(ctx.noBackupFilesDir, "qwen-customvoice-q4-k-v1.gguf")
  private fun partial(ctx: Context) = File(ctx.noBackupFilesDir, "qwen-customvoice-q4-k-v1.part")
  private fun importing(ctx: Context) = File(ctx.noBackupFilesDir, "qwen-customvoice-q4-k-v1.import")
  fun installed(ctx: Context) = model(ctx).length() == MODEL_BYTES
  fun bundled(ctx: Context) = try {
    ctx.assets.openFd(ASSET).use { it.length == MODEL_BYTES }
  } catch (_: IOException) {
    false
  }

  @Synchronized
  fun state(ctx: Context): Map<String, Any?> {
    val ready = NyvemiQwenNative.available && (installed(ctx) || bundled(ctx))
    val state = when {
      !NyvemiQwenNative.available -> "unsupported"
      ready -> "ready"
      phase != null -> phase
      partial(ctx).length() > 0 -> "paused"
      else -> "missing"
    }
    val bytes = when (state) {
      "ready" -> MODEL_BYTES
      "downloading", "importing", "verifying" -> received
      else -> partial(ctx).length()
    }
    return mapOf("phase" to state, "bytes" to bytes, "size" to MODEL_BYTES, "error" to failure)
  }

  @Synchronized
  fun start(ctx: Context, uri: Uri? = null) {
    if (!NyvemiQwenNative.available || installed(ctx) || bundled(ctx) || phase in setOf("downloading", "importing", "verifying")) return
    val app = ctx.applicationContext
    importing(app).delete()
    val stage = if (uri == null) partial(app) else importing(app)
    if (stage.length() > MODEL_BYTES) stage.delete()
    phase = if (uri == null) "downloading" else "importing"
    received = stage.length()
    failure = null
    pauseRequested = false
    worker.execute {
      var error: String? = null
      try {
        val remaining = MODEL_BYTES - stage.length()
        if (app.noBackupFilesDir.usableSpace < remaining + 32L * 1024 * 1024) throw InsufficientSpace()
        if (uri == null) {
          download(stage)
        } else {
          val input = app.contentResolver.openInputStream(uri) ?: throw InvalidModel()
          input.use { append(stage, it, MODEL_BYTES) }
          phase = "verifying"
          if (!verify(stage)) throw InvalidModel()
        }
        if (!pauseRequested) {
          if (!stage.renameTo(model(app))) throw IOException("qwen_install_failed")
          partial(app).delete()
          Log.i("NyvemiQwenPack", "Verified local voice model installed")
        }
      } catch (_: InvalidModel) {
        stage.delete()
        error = "checksum"
      } catch (_: InsufficientSpace) {
        error = "space"
      } catch (_: Exception) {
        error = if (uri == null) "network" else "import"
      } finally {
        if (uri != null) stage.delete()
        synchronized(this) {
          failure = if (pauseRequested) null else error
          phase = if (failure == null) null else "error"
        }
      }
    }
  }

  @Synchronized
  fun pause() {
    if (phase == "downloading") pauseRequested = true
  }

  private fun download(stage: File) {
    for (host in sources) {
      Log.i("NyvemiQwenPack", "Download source: $host, offset: ${stage.length()}")
      try {
        while (!pauseRequested && stage.length() < MODEL_BYTES) fetchRange(stage, host)
        if (pauseRequested) return
        phase = "verifying"
        if (!verify(stage)) throw InvalidModel()
        return
      } catch (error: IOException) {
        if (pauseRequested) return
        if (host == sources.last()) throw error
        if (error is InvalidModel) {
          stage.delete()
          received = 0
        }
        phase = "downloading"
      }
    }
  }

  private fun fetchRange(stage: File, host: String) {
    val start = stage.length()
    val end = minOf(MODEL_BYTES, start + CHUNK_BYTES) - 1
    var url = URL("https://$host/$PATH?download=true&nyvemi_range=$start-$end")
    repeat(8) {
      if (pauseRequested) return
      if (url.protocol != "https") throw IOException("qwen_insecure_redirect")
      val connection = url.openConnection() as HttpsURLConnection
      connection.instanceFollowRedirects = false
      connection.useCaches = false
      connection.connectTimeout = 10000
      connection.readTimeout = 12000
      connection.setRequestProperty("Accept-Encoding", "identity")
      connection.setRequestProperty("Range", "bytes=$start-$end")
      try {
        when (connection.responseCode) {
          301, 302, 303, 307, 308 -> {
            val location = connection.getHeaderField("Location") ?: throw IOException("qwen_missing_redirect")
            url = URL(url, location)
          }
          206 -> {
            if (connection.getHeaderField("Content-Range") != "bytes $start-$end/$MODEL_BYTES")
              throw IOException("qwen_bad_range")
            connection.inputStream.use { append(stage, it, end + 1) }
            return
          }
          200 -> {
            if (start != 0L || connection.getHeaderField("Content-Length")?.toLongOrNull() != MODEL_BYTES)
              throw IOException("qwen_missing_range")
            connection.inputStream.use { append(stage, it, MODEL_BYTES) }
            return
          }
          else -> throw IOException("qwen_http_failed")
        }
      } finally {
        connection.disconnect()
      }
    }
    throw IOException("qwen_redirect_limit")
  }

  private fun append(stage: File, input: InputStream, limit: Long) {
    var total = stage.length()
    stage.outputStreamAppending().use { output ->
      val buffer = ByteArray(128 * 1024)
      while (!pauseRequested) {
        val count = input.read(buffer)
        if (count < 0) break
        if (total + count > limit) throw InvalidModel()
        output.write(buffer, 0, count)
        total += count
        received = total
      }
    }
    if (!pauseRequested && total != limit) throw IOException("qwen_incomplete")
  }

  private fun verify(file: File): Boolean {
    if (file.length() != MODEL_BYTES) return false
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().buffered().use { input ->
      val buffer = ByteArray(128 * 1024)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        digest.update(buffer, 0, count)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) } == SHA256
  }

  private fun File.outputStreamAppending() = java.io.FileOutputStream(this, true).buffered()
}
