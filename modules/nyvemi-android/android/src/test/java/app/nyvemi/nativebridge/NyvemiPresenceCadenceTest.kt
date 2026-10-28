package app.nyvemi.nativebridge

import org.junit.Assert.*
import org.junit.Test

class NyvemiPresenceCadenceTest {
  @Test fun runsImmediatelyThenWaitsTenMinutesAfterSuccess() {
    val cadence = NyvemiPresenceCadence()
    assertTrue(cadence.fullDue(10))
    cadence.fullFinished(100, true)
    assertFalse(cadence.fullDue(600_099))
    assertTrue(cadence.fullDue(600_100))
  }
  @Test fun retriesFailureAfterOneMinuteAndFreshServiceRecoversImmediately() {
    val cadence = NyvemiPresenceCadence()
    cadence.fullFinished(500, false)
    assertFalse(cadence.fullDue(60_499))
    assertTrue(cadence.fullDue(60_500))
    assertTrue(NyvemiPresenceCadence().fullDue(0))
  }
}
