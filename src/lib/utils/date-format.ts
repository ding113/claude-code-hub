/**
 * Date Formatting Utilities with Locale Support
 * Provides locale-aware date formatting using date-fns and next-intl
 */

import type { Locale } from "date-fns";
import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInMonths,
  differenceInSeconds,
  differenceInWeeks,
  differenceInYears,
  format,
  formatDistance,
  formatRelative,
} from "date-fns";
import { enUS, ja, ru, zhCN, zhTW } from "date-fns/locale";

/**
 * Map next-intl locale codes to date-fns locale objects
 */
const LOCALE_MAP: Record<string, Locale> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en: enUS,
  ru: ru,
  ja: ja,
};

/**
 * Get date-fns locale object from next-intl locale string
 * @param locale - next-intl locale code (e.g., "zh-CN", "en")
 * @returns date-fns Locale object
 */
export function getDateFnsLocale(locale: string): Locale {
  return LOCALE_MAP[locale] || enUS;
}

/**
 * Format date with locale support
 * @param date - Date to format
 * @param formatString - Format string (e.g., "yyyy-MM-dd", "PPP")
 * @param locale - next-intl locale code
 * @returns Formatted date string
 */
export function formatDate(
  date: Date | number | string,
  formatString: string,
  locale: string = "zh-CN"
): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const dateFnsLocale = getDateFnsLocale(locale);

  return format(dateObj, formatString, { locale: dateFnsLocale });
}

/**
 * Format distance between two dates with locale support
 * @param date - Date to compare
 * @param baseDate - Base date (defaults to now)
 * @param locale - next-intl locale code
 * @param options - Additional options
 * @returns Formatted distance string (e.g., "3 days ago", "3天前")
 */
export function formatDateDistance(
  date: Date | number | string,
  baseDate: Date | number = new Date(),
  locale: string = "zh-CN",
  options?: {
    addSuffix?: boolean;
    includeSeconds?: boolean;
  }
): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const baseDateObj = typeof baseDate === "string" ? new Date(baseDate) : baseDate;
  const dateFnsLocale = getDateFnsLocale(locale);

  return formatDistance(dateObj, baseDateObj, {
    locale: dateFnsLocale,
    addSuffix: options?.addSuffix ?? true,
    includeSeconds: options?.includeSeconds,
  });
}

/**
 * Format date relative to now with locale support
 * @param date - Date to format
 * @param baseDate - Base date (defaults to now)
 * @param locale - next-intl locale code
 * @returns Formatted relative string (e.g., "yesterday at 3:00 PM", "昨天下午3:00")
 */
export function formatDateRelative(
  date: Date | number | string,
  baseDate: Date | number = new Date(),
  locale: string = "zh-CN"
): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const baseDateObj = typeof baseDate === "string" ? new Date(baseDate) : baseDate;
  const dateFnsLocale = getDateFnsLocale(locale);

  return formatRelative(dateObj, baseDateObj, { locale: dateFnsLocale });
}

/**
 * Common date format patterns for different locales
 */
export const DATE_FORMATS = {
  "zh-CN": {
    short: "yyyy-MM-dd",
    medium: "yyyy年MM月dd日",
    long: "yyyy年MM月dd日 HH:mm:ss",
    time: "HH:mm:ss",
    monthDay: "MM月dd日",
  },
  "zh-TW": {
    short: "yyyy-MM-dd",
    medium: "yyyy年MM月dd日",
    long: "yyyy年MM月dd日 HH:mm:ss",
    time: "HH:mm:ss",
    monthDay: "MM月dd日",
  },
  en: {
    short: "MM/dd/yyyy",
    medium: "MMM dd, yyyy",
    long: "MMMM dd, yyyy HH:mm:ss",
    time: "HH:mm:ss",
    monthDay: "MMM dd",
  },
  ru: {
    short: "dd.MM.yyyy",
    medium: "dd MMM yyyy",
    long: "dd MMMM yyyy HH:mm:ss",
    time: "HH:mm:ss",
    monthDay: "dd MMM",
  },
  ja: {
    short: "yyyy/MM/dd",
    medium: "yyyy年MM月dd日",
    long: "yyyy年MM月dd日 HH:mm:ss",
    time: "HH:mm:ss",
    monthDay: "MM月dd日",
  },
} as const;

/**
 * Get locale-specific date format pattern
 * @param locale - next-intl locale code
 * @param type - Format type
 * @returns Format pattern string
 */
export function getLocaleDateFormat(
  locale: string,
  type: "short" | "medium" | "long" | "time" | "monthDay" = "short"
): string {
  const formats = DATE_FORMATS[locale as keyof typeof DATE_FORMATS] || DATE_FORMATS["zh-CN"];
  return formats[type];
}

/**
 * Short time distance tokens for each locale
 */
const SHORT_DISTANCE_TOKENS: Record<
  string,
  {
    seconds: string;
    minutes: string;
    hours: string;
    days: string;
    weeks: string;
    months: string;
    years: string;
    suffix: string;
  }
> = {
  en: {
    seconds: "s",
    minutes: "m",
    hours: "h",
    days: "d",
    weeks: "w",
    months: "mo",
    years: "y",
    suffix: " ago",
  },
  ru: {
    seconds: "c",
    minutes: "m",
    hours: "h",
    days: "d",
    weeks: "w",
    months: "mo",
    years: "y",
    suffix: " ago",
  },
  "zh-CN": {
    seconds: "s",
    minutes: "m",
    hours: "h",
    days: "d",
    weeks: "w",
    months: "mo",
    years: "y",
    suffix: " ago",
  },
  "zh-TW": {
    seconds: "s",
    minutes: "m",
    hours: "h",
    days: "d",
    weeks: "w",
    months: "mo",
    years: "y",
    suffix: " ago",
  },
  ja: {
    seconds: "s",
    minutes: "m",
    hours: "h",
    days: "d",
    weeks: "w",
    months: "mo",
    years: "y",
    suffix: " ago",
  },
};

/**
 * Format distance between two dates in short format
 * @param date - Date to compare
 * @param baseDate - Base date (defaults to now)
 * @param locale - next-intl locale code
 * @returns Short formatted distance string (e.g., "2h ago", "3d ago")
 */
export function formatDateDistanceShort(
  date: Date | number | string,
  baseDate: Date | number = new Date(),
  locale: string = "zh-CN"
): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const baseDateObj = typeof baseDate === "string" ? new Date(baseDate) : baseDate;
  const tokens = SHORT_DISTANCE_TOKENS[locale] || SHORT_DISTANCE_TOKENS.en;

  const years = differenceInYears(baseDateObj, dateObj);
  if (years > 0) return `${years}${tokens.years}${tokens.suffix}`;

  const months = differenceInMonths(baseDateObj, dateObj);
  if (months > 0) return `${months}${tokens.months}${tokens.suffix}`;

  const weeks = differenceInWeeks(baseDateObj, dateObj);
  if (weeks > 0) return `${weeks}${tokens.weeks}${tokens.suffix}`;

  const days = differenceInDays(baseDateObj, dateObj);
  if (days > 0) return `${days}${tokens.days}${tokens.suffix}`;

  const hours = differenceInHours(baseDateObj, dateObj);
  if (hours > 0) return `${hours}${tokens.hours}${tokens.suffix}`;

  const minutes = differenceInMinutes(baseDateObj, dateObj);
  if (minutes > 0) return `${minutes}${tokens.minutes}${tokens.suffix}`;

  const seconds = differenceInSeconds(baseDateObj, dateObj);
  if (seconds > 0) return `${seconds}${tokens.seconds}${tokens.suffix}`;

  return `0${tokens.seconds}${tokens.suffix}`;
}
