package app.nyvemi.nativebridge

import kotlin.math.abs

/** Source-guided alpha repair. Never invent skin pixels or recolor the source artwork. */
object NyvemiFaceOcclusion {
  private fun distance(a: Int, b: Int): Int =
    abs((a shr 16 and 255) - (b shr 16 and 255)) +
    abs((a shr 8 and 255) - (b shr 8 and 255)) + abs((a and 255) - (b and 255))

  fun shouldClear(source: Int, head: Int, hair: Int, featureAlpha: Int): Boolean {
    if ((source ushr 24) < 192 || (head ushr 24) < 160 || (hair ushr 24) < 32) return false
    // Independent eye/mouth masks are authoritative visible features, not scalp.
    if (featureAlpha >= 160) return true
    val hairDifference = distance(source, hair)
    return hairDifference > 100 && distance(source, head) + 65 < hairDifference
  }
}
