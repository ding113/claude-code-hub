/**
 * Timezone Utilities
 *
 * Provides timezone validation and formatting helpers (client-safe).
 * Uses IANA timezone database identifiers (e.g., "Asia/Shanghai", "America/New_York").
 *
 * Server-only system timezone resolution lives in `timezone.server.ts`.
 */

/**
 * Common IANA timezone identifiers for dropdown UI.
 * Organized by region for better UX.
 */
export const COMMON_TIMEZONES = [
  // UTC
  "UTC",
  // Asia
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Kolkata",
  // Europe
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Europe/Amsterdam",
  "Europe/Rome",
  "Europe/Madrid",
  // Americas
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "America/Denver",
  "America/Toronto",
  "America/Vancouver",
  "America/Sao_Paulo",
  "America/Mexico_City",
  // Pacific
  "Pacific/Auckland",
  "Pacific/Sydney",
  "Australia/Melbourne",
  "Australia/Perth",
] as const;

export type CommonTimezone = (typeof COMMON_TIMEZONES)[number];

/**
 * Validates if a string is a valid IANA timezone identifier.
 *
 * Uses the Intl.DateTimeFormat API which is based on the IANA timezone database.
 * This approach is more reliable than maintaining a static list.
 *
 * @param timezone - The timezone string to validate
 * @returns true if the timezone is valid, false otherwise
 *
 * @example
 * isValidIANATimezone("Asia/Shanghai") // true
 * isValidIANATimezone("America/New_York") // true
 * isValidIANATimezone("UTC") // true
 * isValidIANATimezone("Invalid/Zone") // false
 * isValidIANATimezone("CST") // false (abbreviations not valid)
 */
export function isValidIANATimezone(timezone: string): boolean {
  if (!timezone || typeof timezone !== "string") {
    return false;
  }

  try {
    // Intl.DateTimeFormat will throw if the timezone is invalid
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the display label for a timezone.
 * Returns the offset and common name for UI display.
 *
 * @param timezone - IANA timezone identifier
 * @param locale - Locale for formatting (default: "en")
 * @returns Display label like "(UTC+08:00) Asia/Shanghai"
 */
export function getTimezoneLabel(timezone: string, locale = "en"): string {
  if (!isValidIANATimezone(timezone)) {
    return timezone;
  }

  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      timeZoneName: "longOffset",
    });

    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find((p) => p.type === "timeZoneName");
    const offset = offsetPart?.value || "";

    // Format: "(UTC+08:00) Asia/Shanghai" or "(GMT+08:00) Asia/Shanghai"
    return `(${offset}) ${timezone}`;
  } catch {
    return timezone;
  }
}

/**
 * Gets the current UTC offset in minutes for a timezone.
 *
 * @param timezone - IANA timezone identifier
 * @returns Offset in minutes (positive = ahead of UTC, negative = behind)
 */
export function getTimezoneOffsetMinutes(timezone: string): number {
  if (!isValidIANATimezone(timezone)) {
    return 0;
  }

  const now = new Date();
  const utcDate = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzDate = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

  return (tzDate.getTime() - utcDate.getTime()) / (1000 * 60);
}

/**
 * Resolves the system timezone using the fallback chain:
 *   1. DB system_settings.timezone (via cached settings)
 *   2. env TZ variable
 *   3. "UTC" as final fallback
 *
 * Each candidate is validated via isValidIANATimezone before being accepted.
 *
 * @returns Resolved IANA timezone identifier (always valid)
 */
