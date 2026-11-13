const nativeDate = /现在是 (\d{4}-\d{2}-\d{2})/;
const nativeZone = /时区 ([^，。\s]+)/;
const nativeOffset = /UTC偏移 (-?\d+) 分钟/;
const javascriptOffset = /UTC([+-])(\d{2}):(\d{2})/;

function offsetFromClock(clock: string) {
  const native = nativeOffset.exec(clock);
  if (native) return Number(native[1]);
  const javascript = javascriptOffset.exec(clock);
  if (javascript)
    return (javascript[1] === '-' ? -1 : 1) * (Number(javascript[2]) * 60 + Number(javascript[3]));
}

function formatterForZone(clock: string) {
  const zone = nativeZone.exec(clock)?.[1];
  if (!zone) return;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    if (typeof formatter.formatToParts === 'function') return formatter;
  } catch {
    // Android's zone names may not all be present in the JS engine's time-zone database.
  }
}

export function historyClock(clock: string, now = Date.now()) {
  const formatter = formatterForZone(clock);
  const fixedOffset = offsetFromClock(clock);
  const deviceOffset =
    fixedOffset !== undefined && Math.abs(fixedOffset) <= 14 * 60 ? fixedOffset : undefined;

  function format(timestamp: number) {
    if (formatter) {
      const parts = Object.fromEntries(
        formatter.formatToParts(timestamp).map(({ type, value }) => [type, value]),
      );
      const hour = parts.hour === '24' ? '00' : parts.hour;
      return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}`;
    }
    if (deviceOffset !== undefined)
      return new Date(timestamp + deviceOffset * 60000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');
    const date = new Date(timestamp);
    const pad = (number: number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  const reportedDay = nativeDate.exec(clock)?.[1];
  const reportedMidnight = reportedDay ? Date.parse(`${reportedDay}T00:00:00Z`) : NaN;
  const referenceDay =
    reportedDay && Number.isFinite(reportedMidnight) ? reportedDay : format(now).slice(0, 10);
  const yesterday = new Date(Date.parse(`${referenceDay}T00:00:00Z`) - 86400000)
    .toISOString()
    .slice(0, 10);
  return (timestamp: number) => {
    const localTime = format(timestamp);
    const day = localTime.slice(0, 10);
    return {
      localTime,
      localDay: day === referenceDay ? '今天' : day === yesterday ? '昨天' : day,
    };
  };
}
