import type { SessionMessages } from "./session-details-tabs";

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isNonEmptyPlainRecord(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value) && Object.keys(value).length > 0;
}

export function isSessionMessages(value: unknown): value is SessionMessages {
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    return value.every((item) => isNonEmptyPlainRecord(item));
  }

  return isNonEmptyPlainRecord(value);
}
