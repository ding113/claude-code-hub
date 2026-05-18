declare module "date-fns" {
  export function add(date: Date | number, duration: Duration): Date;
  export function addBusinessDays(date: Date | number, amount: number): Date;
  export function addDays(date: Date | number, amount: number): Date;
  export function addHours(date: Date | number, amount: number): Date;
  export function addMilliseconds(date: Date | number, amount: number): Date;
  export function addMinutes(date: Date | number, amount: number): Date;
  export function addMonths(date: Date | number, amount: number): Date;
  export function addQuarters(date: Date | number, amount: number): Date;
  export function addSeconds(date: Date | number, amount: number): Date;
  export function addWeeks(date: Date | number, amount: number): Date;
  export function addYears(date: Date | number, amount: number): Date;
  export function differenceInCalendarDays(
    dateLeft: Date | number,
    dateRight: Date | number
  ): number;
  export function differenceInDays(dateLeft: Date | number, dateRight: Date | number): number;
  export function differenceInHours(dateLeft: Date | number, dateRight: Date | number): number;
  export function differenceInMilliseconds(
    dateLeft: Date | number,
    dateRight: Date | number
  ): number;
  export function differenceInMinutes(dateLeft: Date | number, dateRight: Date | number): number;
  export function differenceInMonths(dateLeft: Date | number, dateRight: Date | number): number;
  export function differenceInSeconds(dateLeft: Date | number, dateRight: Date | number): number;
  export function differenceInWeeks(dateLeft: Date | number, dateRight: Date | number): number;
  export function differenceInYears(dateLeft: Date | number, dateRight: Date | number): number;
  export function endOfDay(date: Date | number): Date;
  export function endOfMonth(date: Date | number): Date;
  export function endOfWeek(
    date: Date | number,
    options?: { weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6 }
  ): Date;
  export function endOfYear(date: Date | number): Date;
  export function format(date: Date | number, formatStr: string, options?: FormatOptions): string;
  export function formatDistance(
    date: Date | number,
    baseDate: Date | number,
    options?: { addSuffix?: boolean; includeSeconds?: boolean; locale?: Locale }
  ): string;
  export function formatDistanceToNow(
    date: Date | number,
    options?: { addSuffix?: boolean; includeSeconds?: boolean; locale?: Locale }
  ): string;
  export function formatRelative(
    date: Date | number,
    baseDate: Date | number,
    options?: { locale?: Locale }
  ): string;
  export function isAfter(date: Date | number, dateToCompare: Date | number): boolean;
  export function isBefore(date: Date | number, dateToCompare: Date | number): boolean;
  export function isEqual(dateLeft: Date | number, dateRight: Date | number): boolean;
  export function isFuture(date: Date | number): boolean;
  export function isPast(date: Date | number): boolean;
  export function isSameDay(dateLeft: Date | number, dateRight: Date | number): boolean;
  export function isSameMonth(dateLeft: Date | number, dateRight: Date | number): boolean;
  export function isSameYear(dateLeft: Date | number, dateRight: Date | number): boolean;
  export function isValid(date: unknown): boolean;
  export function isWithinInterval(
    date: Date | number,
    interval: { start: Date | number; end: Date | number }
  ): boolean;
  export function max(dates: (Date | number)[]): Date;
  export function min(dates: (Date | number)[]): Date;
  export function parse(
    dateString: string,
    formatString: string,
    referenceDate: Date | number,
    options?: { locale?: Locale }
  ): Date;
  export function parseISO(dateString: string): Date;
  export function set(
    date: Date | number,
    values: {
      year?: number;
      month?: number;
      date?: number;
      hours?: number;
      minutes?: number;
      seconds?: number;
      milliseconds?: number;
    }
  ): Date;
  export function setHours(date: Date | number, hours: number): Date;
  export function setMilliseconds(date: Date | number, milliseconds: number): Date;
  export function setMinutes(date: Date | number, minutes: number): Date;
  export function setSeconds(date: Date | number, seconds: number): Date;
  export function startOfDay(date: Date | number): Date;
  export function startOfHour(date: Date | number): Date;
  export function startOfMinute(date: Date | number): Date;
  export function startOfMonth(date: Date | number): Date;
  export function startOfWeek(
    date: Date | number,
    options?: { weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6 }
  ): Date;
  export function startOfYear(date: Date | number): Date;
  export function sub(date: Date | number, duration: Duration): Date;
  export function subDays(date: Date | number, amount: number): Date;
  export function subHours(date: Date | number, amount: number): Date;
  export function subMinutes(date: Date | number, amount: number): Date;
  export function subMonths(date: Date | number, amount: number): Date;
  export function subWeeks(date: Date | number, amount: number): Date;
  export function subYears(date: Date | number, amount: number): Date;

  export interface Duration {
    years?: number;
    months?: number;
    weeks?: number;
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
  }

  export interface Locale {
    code?: string;
    formatDistance?: (...args: unknown[]) => unknown;
    formatRelative?: (...args: unknown[]) => unknown;
    localize?: Record<string, unknown>;
    formatLong?: Record<string, unknown>;
    match?: Record<string, unknown>;
    options?: {
      weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
      firstWeekContainsDate?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    };
  }

  export interface FormatOptions {
    locale?: Locale;
    weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    firstWeekContainsDate?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    useAdditionalWeekYearTokens?: boolean;
    useAdditionalDayOfYearTokens?: boolean;
  }
}

declare module "date-fns/locale" {
  import type { Locale } from "date-fns";
  export const enUS: Locale;
  export const ja: Locale;
  export const ru: Locale;
  export const zhCN: Locale;
  export const zhTW: Locale;
  export const de: Locale;
  export const fr: Locale;
  export const es: Locale;
  export const ko: Locale;
  export const pt: Locale;
  export const ptBR: Locale;
}
