/** 浏览器与服务端均可安全使用的纯时区工具；不得引入数据库或 Node-only 依赖。 */

export const COMMON_TIMEZONES = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Europe/Amsterdam",
  "Europe/Rome",
  "Europe/Madrid",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "America/Denver",
  "America/Toronto",
  "America/Vancouver",
  "America/Sao_Paulo",
  "America/Mexico_City",
  "Pacific/Auckland",
  "Pacific/Sydney",
  "Australia/Melbourne",
  "Australia/Perth",
] as const;

export type CommonTimezone = (typeof COMMON_TIMEZONES)[number];

/** 使用运行时 IANA 数据库校验时区标识。 */
export function isValidIANATimezone(timezone: string): boolean {
  if (!timezone || typeof timezone !== "string") return false;

  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** 生成包含当前 UTC offset 的下拉框标签。 */
export function getTimezoneLabel(timezone: string, locale: string): string {
  if (!isValidIANATimezone(timezone)) return timezone;

  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      timeZoneName: "longOffset",
    });
    const offset = formatter
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    return `(${offset ?? ""}) ${timezone}`;
  } catch {
    return timezone;
  }
}

/** 返回指定时区当前相对 UTC 的分钟偏移。 */
export function getTimezoneOffsetMinutes(timezone: string): number {
  if (!isValidIANATimezone(timezone)) return 0;

  const now = new Date();
  const utcDate = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const timezoneDate = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  return (timezoneDate.getTime() - utcDate.getTime()) / (1000 * 60);
}
