package app.nyvemi.nativebridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import java.io.File
import java.security.MessageDigest

object NyvemiCharacterRaster {
  private fun source(ctx: Context, uri: String): File {
    require(uri.startsWith("file://")) { "Character image must be an app-owned file" }
    val file = File(Uri.parse(uri).path ?: error("Missing image path")).canonicalFile
    require(listOf(ctx.filesDir, ctx.cacheDir).any { file.path.startsWith(it.canonicalPath + "/") }) { "Image is outside app storage" }
    require(file.exists() && file.length() <= 12 * 1024 * 1024) { "Image is missing or too large" }
    return file
  }
  fun prepare(ctx: Context, uri: String): Map<String, Any> {
    val file = source(ctx, uri)
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, options)
    require(options.outWidth > 0 && options.outHeight > 0 && options.outWidth.toLong() * options.outHeight <= 20_000_000) { "Invalid image dimensions" }
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { stream ->
      val block = ByteArray(8192)
      var count = stream.read(block)
      while (count >= 0) {
        digest.update(block, 0, count)
        count = stream.read(block)
      }
    }
    val hash = digest.digest().joinToString("") { "%02x".format(it) }
    val out = File(ctx.cacheDir, "character-input-v2-$hash.png")
    var width = options.outWidth
    var height = options.outHeight
    if (!out.exists()) {
      val bitmap = BitmapFactory.decodeFile(file.path) ?: error("Cannot decode character image")
      var upright = bitmap
      try {
        val orientation = try { ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1) } catch (_: Exception) { 1 }
        val matrix = Matrix()
        when (orientation) {
          2 -> matrix.setScale(-1f, 1f)
          3 -> matrix.setRotate(180f)
          4 -> matrix.setScale(1f, -1f)
          5 -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
          6 -> matrix.setRotate(90f)
          7 -> { matrix.setRotate(-90f); matrix.postScale(-1f, 1f) }
          8 -> matrix.setRotate(-90f)
        }
        if (!matrix.isIdentity) upright = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        // Canonical sRGB 8-bit PNG, bounded to 2K. No embedded wide-gamut/EXIF metadata reaches the API.
        val scale = minOf(1.0, 2048.0 / maxOf(upright.width, upright.height))
        width = maxOf(1, (upright.width * scale).toInt())
        height = maxOf(1, (upright.height * scale).toInt())
        val canonical = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        canonical.setHasAlpha(upright.hasAlpha())
        Canvas(canonical).drawBitmap(upright, null, Rect(0, 0, width, height), Paint(Paint.FILTER_BITMAP_FLAG))
        val temporary = File(out.path + ".tmp")
        try {
          temporary.outputStream().use { require(canonical.compress(Bitmap.CompressFormat.PNG, 100, it)) }
          require(temporary.length() <= 12 * 1024 * 1024) { "Normalized image exceeds 12 MB" }
          require(temporary.renameTo(out)) { "Could not save normalized image" }
        } finally { temporary.delete(); canonical.recycle() }
      } finally {
        if (upright !== bitmap) upright.recycle()
        bitmap.recycle()
      }
    } else {
      BitmapFactory.decodeFile(out.path, options)
      width = options.outWidth
      height = options.outHeight
    }
    return mapOf("uri" to Uri.fromFile(out).toString(), "width" to width, "height" to height)
  }
  fun analyze(ctx: Context, uri: String): List<Map<String, Any>> {
    val file = source(ctx, uri)
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, options)
    require(options.outWidth > 0 && options.outHeight > 0) { "Invalid image" }
    options.inJustDecodeBounds = false
    options.inSampleSize = 1
    while (maxOf(options.outWidth, options.outHeight) / options.inSampleSize > 512) options.inSampleSize *= 2
    val bitmap = BitmapFactory.decodeFile(file.path, options) ?: error("Cannot decode image")
    try {
      val pixels = IntArray(bitmap.width * bitmap.height)
      bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
      val alpha = IntArray(pixels.size) { pixels[it] ushr 24 }
      return NyvemiRasterGeometry.parts(bitmap.width, bitmap.height, alpha).map { mapOf("crop" to it.crop, "pivot" to it.pivot) }
    } finally { bitmap.recycle() }
  }
}
