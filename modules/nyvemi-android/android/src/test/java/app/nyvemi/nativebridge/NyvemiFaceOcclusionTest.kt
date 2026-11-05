package app.nyvemi.nativebridge
import org.junit.Assert.*
import org.junit.Test
class NyvemiFaceOcclusionTest {
  @Test fun clearsHairOverSourceSkinButPreservesOriginalBangsAndTransparentBoundaries() {
    val skin = 0xffedc5b3.toInt(); val hair = 0xff302020.toInt()
    assertTrue(NyvemiFaceOcclusion.shouldClear(skin, skin, hair, 0))
    assertFalse(NyvemiFaceOcclusion.shouldClear(hair, skin, hair, 0))
    assertFalse(NyvemiFaceOcclusion.shouldClear(skin, 0, hair, 255))
    assertFalse(NyvemiFaceOcclusion.shouldClear(0, skin, hair, 255))
    assertTrue(NyvemiFaceOcclusion.shouldClear(hair, skin, hair, 255))
    assertFalse(NyvemiFaceOcclusion.shouldClear(skin, skin, skin, 0))
  }
}
