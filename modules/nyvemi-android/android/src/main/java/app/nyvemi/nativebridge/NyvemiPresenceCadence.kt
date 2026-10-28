package app.nyvemi.nativebridge

/** Monotonic time: clock/time-zone changes cannot suppress local maintenance for hours. */
internal class NyvemiPresenceCadence {
  @Volatile private var nextFullAt = 0L
  fun fullDue(elapsed: Long): Boolean = elapsed >= nextFullAt
  fun fullFinished(elapsed: Long, success: Boolean) {
    nextFullAt = elapsed + if (success) 600_000 else 60_000
  }
}
