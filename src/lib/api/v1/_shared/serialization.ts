export function toIsoDateTime(value: Date | string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function serializeDates(value: unknown): unknown {
  if (isDateLike(value)) return dateToIsoString(value);
  if (Array.isArray(value)) return value.map((item) => serializeDates(item));
  if (!value || typeof value !== "object") return value;
  if (hasJsonSerializer(value)) {
    const jsonValue = value.toJSON();
    if (jsonValue !== value) return serializeDates(jsonValue);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, serializeDates(item)])
  );
}

function isDateLike(value: unknown): value is Date {
  return (
    value instanceof Date ||
    Object.prototype.toString.call(value) === "[object Date]" ||
    (Boolean(value) &&
      typeof value === "object" &&
      typeof (value as Date).getTime === "function" &&
      typeof (value as Date).toISOString === "function")
  );
}

function dateToIsoString(date: Date): string | null {
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return null;
  return date.toISOString();
}

function hasJsonSerializer(value: object): value is { toJSON: () => unknown } {
  return typeof (value as { toJSON?: unknown }).toJSON === "function";
}
