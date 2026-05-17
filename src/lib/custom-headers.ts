// Shared parser/validator for provider-level custom HTTP headers.
// Framework-free: safe to import from server actions, validation schemas, and React components.
// Returns stable error codes so callers can map to localized messages.

export type CustomHeadersValidationErrorCode =
  | "invalid_json"
  | "not_object"
  | "invalid_name"
  | "duplicate_name"
  | "protected_name"
  | "invalid_value"
  | "empty_name"
  | "crlf";

export type CustomHeadersParseResult =
  | { ok: true; value: Record<string, string> | null }
  | { ok: false; code: CustomHeadersValidationErrorCode; path?: string };

export const CUSTOM_HEADERS_PLACEHOLDER = '{"cf-aig-authorization": "Bearer your-token"}';

const HTTP_TOKEN_NAME_REGEX = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export const PROTECTED_AUTH_HEADER_NAMES: ReadonlySet<string> = new Set([
  "authorization",
  "x-api-key",
  "x-goog-api-key",
]);

function hasCrlf(s: string): boolean {
  return s.indexOf("\r") !== -1 || s.indexOf("\n") !== -1;
}

export function normalizeCustomHeadersRecord(input: unknown): CustomHeadersParseResult {
  if (input === null || input === undefined) return { ok: false, code: "not_object" };
  if (typeof input !== "object") return { ok: false, code: "not_object" };
  if (Array.isArray(input)) return { ok: false, code: "not_object" };

  const obj = input as Record<string, unknown>;
  const names = Object.keys(obj);
  if (names.length === 0) return { ok: true, value: null };

  const seenLower = new Set<string>();
  const out: Record<string, string> = {};

  for (const name of names) {
    if (name.length === 0 || name.trim().length === 0) {
      return { ok: false, code: "empty_name", path: name };
    }
    if (hasCrlf(name)) return { ok: false, code: "crlf", path: name };
    if (!HTTP_TOKEN_NAME_REGEX.test(name)) {
      return { ok: false, code: "invalid_name", path: name };
    }

    const lower = name.toLowerCase();
    if (PROTECTED_AUTH_HEADER_NAMES.has(lower)) {
      return { ok: false, code: "protected_name", path: name };
    }
    if (seenLower.has(lower)) {
      return { ok: false, code: "duplicate_name", path: name };
    }
    seenLower.add(lower);

    const value = obj[name];
    if (typeof value !== "string") return { ok: false, code: "invalid_value", path: name };
    if (hasCrlf(value)) return { ok: false, code: "crlf", path: name };

    out[name] = value;
  }

  return { ok: true, value: out };
}

export function parseCustomHeadersJsonText(text: string): CustomHeadersParseResult {
  if (typeof text !== "string") return { ok: false, code: "invalid_json" };
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: true, value: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, code: "invalid_json" };
  }

  return normalizeCustomHeadersRecord(parsed);
}

export function stringifyCustomHeadersForTextarea(
  value: Record<string, string> | null | undefined
): string {
  if (!value) return "";
  if (Object.keys(value).length === 0) return "";
  return JSON.stringify(value, null, 2);
}
