const HTTP_FALLBACK_STATUSES = new Set([400, 413, 422, 507]);
const SIZE_SIGNALS = [
  "payload too large",
  "payload exceeds",
  "payload size",
  "request too large",
  "request body too large",
  "body too large",
  "content too large",
  "context length",
  "context too large",
  "maximum bytes",
  "max bytes",
  "image exceeds",
  "too many bytes",
  "too large",
];
const DEFAULT_MESSAGE = "upstream rejected the WebSocket request as too large";

function getJsonNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getJsonString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Recognize request-size errors without treating arbitrary 4xx events as transport failures. */
export function getUpstreamPayloadTooLargeMessage(payload: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const event = parsed as Record<string, unknown>;
  if (event.type !== "error") return null;

  const status = getJsonNumber(event.status) ?? getJsonNumber(event.status_code);
  if (status === null || !HTTP_FALLBACK_STATUSES.has(status)) return null;

  const error = event.error && typeof event.error === "object" ? event.error : {};
  const errorRecord = error as Record<string, unknown>;
  const code = getJsonString(errorRecord.code);
  const type = getJsonString(errorRecord.type);
  const message = getJsonString(errorRecord.message);
  if (status === 413) return message || DEFAULT_MESSAGE;

  const description = `${code} ${type} ${message}`.toLowerCase();
  return SIZE_SIGNALS.some((signal) => description.includes(signal))
    ? message || DEFAULT_MESSAGE
    : null;
}
