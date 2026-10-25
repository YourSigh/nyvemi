export function isQuietHour(now: number, start: number, end: number): boolean {
  if (start === end) return false;
  const hour = new Date(now).getHours();
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

export function nextOutsideQuietHours(time: number, start: number, end: number): number {
  if (!isQuietHour(time, start, end)) return time;
  const result = new Date(time);
  result.setHours(end, 0, 0, 0);
  if (result.getTime() <= time) result.setDate(result.getDate() + 1);
  return result.getTime();
}
