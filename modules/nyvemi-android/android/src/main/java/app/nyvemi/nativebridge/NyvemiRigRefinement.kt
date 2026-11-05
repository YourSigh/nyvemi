package app.nyvemi.nativebridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** Local, deterministic face visibility repair using source colors and part alpha masks. */
object NyvemiRigRefinement {
  private data class Raster(val bitmap: Bitmap, val pixels: IntArray) {
    fun sample(x: Double, y: Double): Int {
      if (x < 0 || x >= 1 || y < 0 || y >= 1) return 0
      return pixels[(y * bitmap.height).toInt().coerceIn(0, bitmap.height - 1) * bitmap.width +
        (x * bitmap.width).toInt().coerceIn(0, bitmap.width - 1)]
    }
  }
  private fun file(ctx: Context, uri: String): File {
    require(uri.startsWith("file://"))
    val f = File(Uri.parse(uri).path ?: error("Missing image path")).canonicalFile
    require(listOf(ctx.filesDir, ctx.cacheDir).any { f.path.startsWith(it.canonicalPath + "/") })
    require(f.exists() && f.length() <= 12 * 1024 * 1024)
    return f
  }
  private fun read(f: File): Raster {
    val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(f.path, o)
    require(o.outWidth > 0 && o.outHeight > 0 && o.outWidth.toLong() * o.outHeight <= 20_000_000)
    o.inJustDecodeBounds = false
    o.inSampleSize = 1
    while (maxOf(o.outWidth, o.outHeight) / o.inSampleSize > 2048) o.inSampleSize *= 2
    val bitmap = BitmapFactory.decodeFile(f.path, o) ?: error("Cannot decode rig part")
    val pixels = IntArray(bitmap.width * bitmap.height)
    bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
    return Raster(bitmap, pixels)
  }
  fun refine(ctx: Context, sourceUri: String, spec: String): List<Map<String, Any>> {
    require(spec.length < 100000)
    val json = JSONObject(spec)
    val layers = json.getJSONArray("layers")
    require(layers.length() in 3..32)
    val parts = (0 until layers.length()).map { layers.getJSONObject(it) }
    fun bounds(part: JSONObject) = part.getJSONArray("bounds").let { a ->
      require(a.length() == 4)
      DoubleArray(4) { a.getDouble(it).also { n -> require(n.isFinite() && n in 0.0..1.0) } }
        .also { require(it[2] > 0 && it[3] > 0) }
    }
    val head = parts.firstOrNull { it.getString("role") == "head" } ?: return emptyList()
    val hair = parts.withIndex().filter { it.value.getString("role") == "hair" &&
      !it.value.getJSONObject("asset").getString("uri").contains("occlusion-v1-") }
    if (hair.isEmpty()) return emptyList()
    val opened = mutableListOf<Raster>()
    fun load(uri: String) = read(file(ctx, uri)).also { opened.add(it) }
    try {
      val normalized = NyvemiCharacterRaster.prepare(ctx, sourceUri)["uri"] as String
      val source = load(normalized)
      val headRaster = load(head.getJSONObject("asset").getString("uri"))
      val headBounds = bounds(head)
      val features = parts.filter { it.getString("role") in listOf("eyes", "mouth") }
        .map { bounds(it) to load(it.getJSONObject("asset").getString("uri")) }
      fun sample(r: Raster, b: DoubleArray, x: Double, y: Double) = r.sample((x - b[0]) / b[2], (y - b[1]) / b[3])
      return hair.mapNotNull { (index, part) ->
        val uri = part.getJSONObject("asset").getString("uri")
        val pixels = load(uri)
        val b = bounds(part)
        var cleared = 0
        for (y in 0 until pixels.bitmap.height) for (x in 0 until pixels.bitmap.width) {
          val gx = b[0] + (x + 0.5) / pixels.bitmap.width * b[2]
          val gy = b[1] + (y + 0.5) / pixels.bitmap.height * b[3]
          val offset = y * pixels.bitmap.width + x
          val alpha = features.maxOfOrNull { (fb, fr) -> sample(fr, fb, gx, gy) ushr 24 } ?: 0
          if (NyvemiFaceOcclusion.shouldClear(source.sample(gx, gy), sample(headRaster, headBounds, gx, gy), pixels.pixels[offset], alpha)) {
            pixels.pixels[offset] = pixels.pixels[offset] and 0x00ffffff
            cleared++
          }
        }
        if (cleared == 0) return@mapNotNull null
        val digest = MessageDigest.getInstance("SHA-256").digest((normalized + spec + index).toByteArray()).joinToString("") { "%02x".format(it) }
        val folder = File(ctx.filesDir, "character-images").apply { mkdirs() }
        val out = File(folder, "occlusion-v1-$digest.png")
        if (!out.exists()) {
          val result = Bitmap.createBitmap(pixels.pixels, pixels.bitmap.width, pixels.bitmap.height, Bitmap.Config.ARGB_8888)
          val tmp = File(out.path + ".tmp")
          try {
            tmp.outputStream().use { require(result.compress(Bitmap.CompressFormat.PNG, 100, it)) }
            require(tmp.renameTo(out))
          } finally { result.recycle(); tmp.delete() }
        }
        mapOf("index" to index, "uri" to Uri.fromFile(out).toString(), "width" to pixels.bitmap.width,
          "height" to pixels.bitmap.height, "clearedPixels" to cleared)
      }
    } finally { opened.forEach { it.bitmap.recycle() } }
  }
}
