declare module "date-fns" {
  export interface Locale {
    code?: string;
    formatDistance?: (...args: unknown[]) => string;
    formatRelative?: (...args: unknown[]) => string;
    localize?: object;
    formatLong?: object;
    match?: object;
    options?: object;
  }

  export function format(date: Date | number | string, formatStr: string, options?: object): string;
  export function formatDistance(
    date: Date | number | string,
    baseDate: Date | number | string,
    options?: object
  ): string;
  export function formatDistanceToNow(date: Date | number | string, options?: object): string;
  export function formatRelative(
    date: Date | number | string,
    baseDate: Date | number | string,
    options?: object
  ): string;
  export function parseISO(dateString: string, options?: object): Date;
  export function isValid(date: unknown): boolean;
  export function isBefore(
    date: Date | number | string,
    dateToCompare: Date | number | string
  ): boolean;
  export function isAfter(
    date: Date | number | string,
    dateToCompare: Date | number | string
  ): boolean;
  export function addDays(date: Date | number | string, amount: number): Date;
  export function addMonths(date: Date | number | string, amount: number): Date;
  export function addYears(date: Date | number | string, amount: number): Date;
  export function addHours(date: Date | number | string, amount: number): Date;
  export function addMinutes(date: Date | number | string, amount: number): Date;
  export function subDays(date: Date | number | string, amount: number): Date;
  export function subMonths(date: Date | number | string, amount: number): Date;
  export function subHours(date: Date | number | string, amount: number): Date;
  export function subMinutes(date: Date | number | string, amount: number): Date;
  export function addWeeks(date: Date | number | string, amount: number): Date;
  export function setMilliseconds(date: Date | number | string, milliseconds: number): Date;
  export function setSeconds(date: Date | number | string, seconds: number): Date;
  export function startOfDay(date: Date | number | string): Date;
  export function endOfDay(date: Date | number | string): Date;
  export function startOfWeek(date: Date | number | string, options?: object): Date;
  export function endOfWeek(date: Date | number | string, options?: object): Date;
  export function startOfMonth(date: Date | number | string): Date;
  export function endOfMonth(date: Date | number | string): Date;
  export function startOfYear(date: Date | number | string): Date;
  export function endOfYear(date: Date | number | string): Date;
  export function differenceInDays(
    dateLeft: Date | number | string,
    dateRight: Date | number | string
  ): number;
  export function differenceInHours(
    dateLeft: Date | number | string,
    dateRight: Date | number | string
  ): number;
  export function differenceInMinutes(
    dateLeft: Date | number | string,
    dateRight: Date | number | string
  ): number;
  export function differenceInCalendarDays(
    dateLeft: Date | number | string,
    dateRight: Date | number | string
  ): number;
  export function set(date: Date | number | string, values: object): Date;
  export function setHours(date: Date | number | string, hours: number): Date;
  export function setMinutes(date: Date | number | string, minutes: number): Date;
  export function getHours(date: Date | number | string): number;
  export function getMinutes(date: Date | number | string): number;
  export function isSameDay(
    dateLeft: Date | number | string,
    dateRight: Date | number | string
  ): boolean;
  export function isToday(date: Date | number | string): boolean;
  export function isPast(date: Date | number | string): boolean;
  export function isFuture(date: Date | number | string): boolean;
  export function parse(
    dateString: string,
    formatString: string,
    referenceDate: Date | number | string,
    options?: object
  ): Date;
  export function toDate(argument: Date | number | string): Date;
  export function eachDayOfInterval(interval: {
    start: Date | number | string;
    end: Date | number | string;
  }): Date[];
  export function eachHourOfInterval(interval: {
    start: Date | number | string;
    end: Date | number | string;
  }): Date[];
  export function isWithinInterval(
    date: Date | number | string,
    interval: { start: Date | number | string; end: Date | number | string }
  ): boolean;
}

declare module "date-fns/locale" {
  export const zhCN: object;
  export const zhTW: object;
  export const enUS: object;
  export const ja: object;
  export const ru: object;
}
