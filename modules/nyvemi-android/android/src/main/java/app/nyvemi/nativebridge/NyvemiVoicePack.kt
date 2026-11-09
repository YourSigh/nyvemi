package app.nyvemi.nativebridge

import android.content.Context
import android.util.Log
import java.io.File
import java.net.URL
import java.security.MessageDigest
import javax.net.ssl.HttpsURLConnection

/** The runtime accepts data from this pinned catalog entry only. */
internal object NyvemiVoicePack {
  private const val URL_STRING = "https://huggingface.co/csukuangfj/kokoro-int8-multi-lang-v1_1/resolve/1355334be009ccce397060ee639a874137a128fa/voices.bin?download=true"
  private const val SHA256 = "e64a5a581d8c2a350d848f51c3121657cd83aa07ed6109172177345874a7244c"
  private const val VOICE_BYTES = 53790720L
  private const val ASSETS = "nyvemi-tts"
  private val modelFiles = listOf("model.int8.onnx", "tokens.txt", "lexicon-zh.txt", "lexicon-us-en.txt",
    "phone-zh.fst", "date-zh.fst", "number-zh.fst")

  fun path(context: Context) = File(context.noBackupFilesDir, "nyvemi-kokoro-plus-v1")
  fun installed(context: Context) = File(path(context), "voices.bin").length() == VOICE_BYTES

  @Synchronized
  fun install(context: Context) {
    if (installed(context)) return
    val target = path(context)
    check(target.parentFile!!.usableSpace >= 185L * 1024 * 1024)
    val staging = File(target.parentFile, target.name + ".partial")
    staging.deleteRecursively()
    check(staging.mkdir())
    try {
      download(File(staging, "voices.bin"))
      for (name in modelFiles) {
        context.assets.open("$ASSETS/$name").use { input ->
          File(staging, name).outputStream().use { output -> input.copyTo(output) }
        }
      }
      if (target.exists()) check(target.deleteRecursively())
      check(staging.renameTo(target))
      Log.i("NyvemiVoicePack", "verified and installed $VOICE_BYTES voice bytes")
    } finally {
      staging.deleteRecursively()
    }
  }

  private fun download(file: File) {
    var url = URL(URL_STRING)
    repeat(5) {
      check(url.protocol == "https" && (url.host == "huggingface.co" || url.host.endsWith(".hf.co")))
      val connection = url.openConnection() as HttpsURLConnection
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 15000
      connection.readTimeout = 25000
      connection.setRequestProperty("Accept-Encoding", "identity")
      try {
        val status = connection.responseCode
        if (status in 300..399) {
          url = URL(url, checkNotNull(connection.getHeaderField("Location")))
          return@repeat
        }
        check(status == 200)
        val length = connection.getHeaderField("Content-Length")?.toLongOrNull()
        check(length == null || length == VOICE_BYTES)
        val digest = MessageDigest.getInstance("SHA-256")
        var total = 0L
        connection.inputStream.use { input ->
          file.outputStream().buffered().use { output ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
              val count = input.read(buffer)
              if (count < 0) break
              total += count
              check(total <= VOICE_BYTES)
              digest.update(buffer, 0, count)
              output.write(buffer, 0, count)
            }
          }
        }
        check(total == VOICE_BYTES)
        check(digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) } == SHA256)
        return
      } finally {
        connection.disconnect()
      }
    }
    error("Too many voice data redirects")
  }
}
