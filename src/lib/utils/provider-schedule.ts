/**
 * Provider Schedule Utilities
 *
 * Determines whether a provider is currently within its configured active time window.
 * Supports same-day and cross-day (overnight) schedules using the system timezone.
 */

/**
 * Check if a provider is currently active based on its schedule configuration.
 *
 * @param startTime - HH:mm format start time, or null (always active)
 * @param endTime - HH:mm format end time, or null (always active)
 * @param timezone - IANA timezone identifier (e.g., "Asia/Shanghai")
 * @param now - Optional Date override for testing
 * @returns true if the provider is currently active
 *
 * Rules:
 * - Both null -> always active (true)
 * - Either null -> always active (true) (defensive; validation ensures both-or-neither)
 * - start === end -> false (zero-width window; validation blocks this input)
 * - Same-day (start < end): start <= now < end
 * - Cross-day (start > end): now >= start || now < end
 */
export function isProviderActiveNow(
  startTime: string | null,
  endTime: string | null,
  timezone: string,
  now: Date = new Date()
): boolean {
  if (startTime == null || endTime == null) {
    return true;
  }

  if (startTime === endTime) {
    return false;
  }

  const nowMinutes = getCurrentMinutesInTimezone(now, timezone);
  const startMinutes = parseHHMM(startTime);
  const endMinutes = parseHHMM(endTime);

  // Fail-open: if DB contains malformed time values, treat provider as always active
  if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes)) {
    return true;
  }

  if (startMinutes < endMinutes) {
    // Same-day: start <= now < end
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }

  // Cross-day: now >= start || now < end
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseHHMM(time: string): number {
  const match = HHMM_RE.exec(time);
  if (!match) {
    return Number.NaN;
  }
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

function getCurrentMinutesInTimezone(now: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);

  return hour * 60 + minute;
}
