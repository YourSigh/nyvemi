package app.nyvemi.nativebridge
import org.junit.Assert.*
import org.junit.Test
class NyvemiRasterGeometryTest {
  @Test fun separatesDisconnectedArmsAndLocatesShoulders() {
    val w = 100; val h = 80; val alpha = IntArray(w * h)
    for (y in 10..70) for (x in 5..20) alpha[y * w + x] = 255
    for (y in 15..75) for (x in 80..95) alpha[y * w + x] = 255
    val parts = NyvemiRasterGeometry.parts(w, h, alpha)
    assertEquals(2, parts.size)
    assertTrue(parts[0].pivot[0] < 0.3)
    assertTrue(parts[1].pivot[0] > 0.7)
    assertEquals(10.5 / h, parts[0].pivot[1], 0.0001)
    assertEquals(15.5 / h, parts[1].pivot[1], 0.0001)
    assertEquals(1.0, parts.sumOf { it.crop[2] }, 0.0001)
  }
  @Test fun neverCutsConnectedArtworkAndHandlesEmptyAlpha() {
    assertEquals(1, NyvemiRasterGeometry.parts(100, 80, IntArray(8000) { 255 }).size)
    assertTrue(NyvemiRasterGeometry.parts(100, 80, IntArray(8000)).isEmpty())
  }
}
