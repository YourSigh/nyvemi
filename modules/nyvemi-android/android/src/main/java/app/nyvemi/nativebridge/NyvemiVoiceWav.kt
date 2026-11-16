package app.nyvemi.nativebridge

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import java.io.FileInputStream
import java.util.concurrent.Executors

/** One cache-file playback at a time. All lifecycle transitions run on main. */
class NyvemiVoiceWav {
  private val handler = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private class Playback(val promise: Promise) {
    var player: MediaPlayer? = null
    var timeout: Runnable? = null
  }
  private var current: Playback? = null
  private var closed = false

  fun play(ctx: Context, id: String, uri: String, promise: Promise) {
    stop()
    if (closed || id.isBlank() || id.length > 180) {
      promise.resolve(false)
      return
    }
    val playback = Playback(promise)
    current = playback
    val timeout = Runnable { finish(playback, false) }
    playback.timeout = timeout
    handler.postDelayed(timeout, 180_000)
    val cache = ctx.cacheDir
    try {
      io.execute {
        var input: FileInputStream? = null
        try {
          val file = NyvemiVoiceWavPolicy.cacheFile(cache, uri)
          input = FileInputStream(file)
          NyvemiVoiceWavPolicy.validateHeader(input, file.length())
          val opened = input
          input = null
          handler.post {
            try {
              if (current !== playback) return@post
              val player = MediaPlayer()
              playback.player = player
              player.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
              player.setOnCompletionListener { finish(playback, true) }
              player.setOnErrorListener { _, _, _ -> finish(playback, false); true }
              player.setOnPreparedListener {
                if (current === playback) {
                  try { it.start() } catch (_: Exception) { finish(playback, false) }
                }
              }
              player.setDataSource(opened.fd)
              player.prepareAsync()
            } catch (_: Exception) { finish(playback, false) }
            finally { runCatching { opened.close() } }
          }
        } catch (_: Exception) {
          runCatching { input?.close() }
          handler.post { finish(playback, false) }
        }
      }
    } catch (_: Exception) { finish(playback, false) }
  }

  private fun finish(playback: Playback, success: Boolean) {
    if (current !== playback) return
    current = null
    playback.timeout?.let(handler::removeCallbacks)
    playback.player?.let { player ->
      player.setOnCompletionListener(null)
      player.setOnErrorListener(null)
      player.setOnPreparedListener(null)
      runCatching { player.release() }
    }
    playback.player = null
    playback.promise.resolve(success)
  }

  fun stop() {
    if (Looper.myLooper() != Looper.getMainLooper()) { handler.post { stop() }; return }
    current?.let { finish(it, false) }
  }
  fun shutdown() {
    if (Looper.myLooper() != Looper.getMainLooper()) { handler.post { shutdown() }; return }
    closed = true; stop(); io.shutdown()
  }
}
