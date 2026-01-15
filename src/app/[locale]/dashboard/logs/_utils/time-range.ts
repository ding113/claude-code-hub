export interface ClockParts {
  hours: number;
  minutes: number;
  seconds: number;
}

export function parseClockString(clockStr: string): ClockParts {
  const [hoursRaw, minutesRaw, secondsRaw] = clockStr.split(":");

  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw ?? "0");

  return {
    hours: Number.isFinite(hours) ? hours : 0,
    minutes: Number.isFinite(minutes) ? minutes : 0,
    seconds: Number.isFinite(seconds) ? seconds : 0,
  };
}

export function formatClockFromTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  const ss = `${date.getSeconds()}`.padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function dateStringWithClockToTimestamp(
  dateStr: string,
  clockStr: string
): number | undefined {
  const [year, month, day] = dateStr.split("-").map(Number);
  const { hours, minutes, seconds } = parseClockString(clockStr);

  const date = new Date(year, month - 1, day, hours, minutes, seconds, 0);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return undefined;

  if (date.getFullYear() !== year) return undefined;
  if (date.getMonth() !== month - 1) return undefined;
  if (date.getDate() !== day) return undefined;

  return timestamp;
}

export function inclusiveEndTimestampFromExclusive(endExclusiveTimestamp: number): number {
  return Math.max(0, endExclusiveTimestamp - 1000);
}
