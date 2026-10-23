// Clip the old screenshot to the half-plane x+y >= distance. New colors are
// revealed from the upper-left corner without mounting a second app tree.
export function remainingPolygon(width: number, height: number, progress: number): string {
  'worklet';
  const distance = Math.max(0, Math.min(1, progress)) * (width + height);
  const points = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const output: number[][] = [];
  for (let n = 0; n < points.length; n++) {
    const a = points[n],
      b = points[(n + 1) % points.length];
    const av = a[0] + a[1] - distance,
      bv = b[0] + b[1] - distance;
    if (av >= 0) output.push(a);
    if (av >= 0 !== bv >= 0) {
      const t = av / (av - bv);
      output.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return output.length
    ? output.map((point) => `${point[0]},${point[1]}`).join(' ')
    : `${width},${height} ${width},${height} ${width},${height}`;
}
