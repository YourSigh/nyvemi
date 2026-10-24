package app.nyvemi.nativebridge

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.Shader
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.LinearInterpolator
import kotlin.math.min
import kotlin.math.sqrt

/** Only an in-memory image of our own window. Nothing is written to cache or exported. */
class NyvemiThemeTransition {
  private val handler = Handler(Looper.getMainLooper())
  private var overlay: RevealView? = null
  private var animator: ValueAnimator? = null
  private var completion: (() -> Unit)? = null
  private val timeout = Runnable { finish() }

  fun prepare(activity: Activity?): Boolean {
    finish()
    val decor = activity?.window?.decorView as? ViewGroup ?: return false
    if (decor.width <= 0 || decor.height <= 0 || !decor.isAttachedToWindow) return false
    // Cap memory on high-density devices, while drawing at the actual window size.
    val scale = min(1.0, sqrt(4_000_000.0 / (decor.width.toDouble() * decor.height)))
    var bitmap: Bitmap? = null
    return try {
      bitmap = Bitmap.createBitmap((decor.width * scale).toInt().coerceAtLeast(1), (decor.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
      val canvas = Canvas(bitmap)
      canvas.scale(scale.toFloat(), scale.toFloat())
      decor.draw(canvas)
      val image = RevealView(decor.context, bitmap)
      bitmap = null // The view owns the bitmap from this point.
      image.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
      image.elevation = 10000f
      decor.addView(image, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      overlay = image
      handler.postDelayed(timeout, 6000)
      true
    } catch (_: Exception) {
      bitmap?.recycle()
      finish()
      false
    } catch (_: OutOfMemoryError) {
      bitmap?.recycle()
      finish()
      false
    }
  }

  fun reveal(durationMs: Int, done: () -> Unit) {
    val view = overlay
    if (view == null || !view.isAttachedToWindow) { finish(); done(); return }
    completion = done
    handler.removeCallbacks(timeout)
    handler.postDelayed(timeout, durationMs.coerceIn(1200, 3500).toLong() + 1000)
    // Let the newly committed React tree draw underneath before moving the mask.
    view.postOnAnimation {
      if (overlay !== view) return@postOnAnimation
      animator = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = durationMs.coerceIn(1200, 3500).toLong()
        interpolator = LinearInterpolator()
        addUpdateListener { view.progress = it.animatedValue as Float; view.invalidate() }
        addListener(object : AnimatorListenerAdapter() { override fun onAnimationEnd(animation: Animator) { finish() } })
        start()
      }
    }
  }

  fun finish() {
    if (Looper.myLooper() != Looper.getMainLooper()) { handler.post { finish() }; return }
    handler.removeCallbacks(timeout)
    val previous = animator
    animator = null
    previous?.removeAllListeners()
    previous?.cancel()
    val image = overlay
    overlay = null
    (image?.parent as? ViewGroup)?.removeView(image)
    image?.release()
    val done = completion
    completion = null
    done?.invoke()
  }

  private class RevealView(context: Context, private var image: Bitmap?) : View(context) {
    var progress = 0f
    private val bitmapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val mask = Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN) }
    private val bounds = RectF()
    // The live app remains visible behind the transparent upper-left part.
    override fun onDraw(canvas: Canvas) {
      super.onDraw(canvas)
      val bitmap = image ?: return
      bounds.set(0f, 0f, width.toFloat(), height.toFloat())
      val feather = 130f * resources.displayMetrics.density
      val distance = -feather + progress * (width + height + 2 * feather)
      val start = (distance - feather) / 2
      val end = (distance + feather) / 2
      mask.shader = LinearGradient(start, start, end, end, Color.TRANSPARENT, Color.BLACK, Shader.TileMode.CLAMP)
      val layer = canvas.saveLayer(bounds, null)
      canvas.drawBitmap(bitmap, null, bounds, bitmapPaint)
      canvas.drawRect(bounds, mask)
      canvas.restoreToCount(layer)
    }
    override fun onTouchEvent(event: MotionEvent): Boolean = true
    fun release() { image = null }
  }
}
