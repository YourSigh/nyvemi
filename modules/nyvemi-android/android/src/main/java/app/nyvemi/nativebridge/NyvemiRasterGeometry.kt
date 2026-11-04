package app.nyvemi.nativebridge

/** Alpha-only layout analysis. Coordinates are relative to the source texture. */
object NyvemiRasterGeometry {
  data class Part(val crop: List<Double>, val pivot: List<Double>)

  fun parts(width: Int, height: Int, alpha: IntArray): List<Part> {
    require(width > 0 && height > 0 && alpha.size == width * height)
    val columns = IntArray(width)
    for (y in 0 until height) for (x in 0 until width) {
      if (alpha[y * width + x] >= 32) columns[x]++
    }
    if (columns.none { it > 0 }) return emptyList()
    // Only split through a genuinely transparent internal gap. Never cut connected artwork.
    var bestStart = -1
    var bestEnd = -1
    var start = -1
    for (x in width / 5 until width * 4 / 5) {
      if (columns[x] == 0) {
        if (start == -1) start = x
      } else if (start != -1) {
        if (x - start > bestEnd - bestStart) {
          bestStart = start
          bestEnd = x
        }
        start = -1
      }
    }
    if (start != -1 && width * 4 / 5 - start > bestEnd - bestStart) {
      bestStart = start
      bestEnd = width * 4 / 5
    }
    val cut = if (bestStart >= 0 && bestEnd - bestStart >= maxOf(2, width / 100)) (bestStart + bestEnd) / 2 else -1
    val ranges = if (cut > 0 && columns.take(cut).sum() > 0 && columns.drop(cut).sum() > 0)
      listOf(0 until cut, cut until width) else listOf(0 until width)
    return ranges.mapNotNull { range ->
      var minX = width
      var maxX = -1
      var minY = height
      var maxY = -1
      for (y in 0 until height) for (x in range) if (alpha[y * width + x] >= 32) {
        minX = minOf(minX, x)
        maxX = maxOf(maxX, x)
        minY = minOf(minY, y)
        maxY = maxOf(maxY, y)
      }
      if (maxX < minX) return@mapNotNull null
      // The top band is the shoulder attachment, even when a hand/prop crosses the torso.
      val bandEnd = minOf(maxY, minY + maxOf(1, (maxY - minY) / 10))
      var sumX = 0L
      var count = 0
      for (y in minY..bandEnd) for (x in minX..maxX) if (alpha[y * width + x] >= 32) {
        sumX += x
        count++
      }
      Part(
        listOf(range.first.toDouble() / width, 0.0, range.count().toDouble() / width, 1.0),
        listOf((sumX.toDouble() / count + 0.5) / width, (minY + 0.5) / height),
      )
    }
  }
}
