// Shared parser/validator for provider-level custom HTTP headers.
// Framework-free: safe to import from server actions, validation schemas, and React components.
// Returns stable error codes so callers can map to localized messages.
//
// Values are either static strings or mustache-style templates evaluated at request time:
//   {{header.Name}}          copy an inbound request header (after request filters)
//   {{session.id}}           CCH session ID (client-provided or assigned)
//   {{session.client_id}}    original client session ID only
// Missing sources skip that outbound header instead of sending an empty or raw template.

export type CustomHeadersValidationErrorCode =
  | "invalid_json"
  | "not_object"
  | "invalid_name"
  | "duplicate_name"
  | "protected_name"
  | "invalid_value"
  | "empty_name"
  | "crlf"
  | "invalid_template";

export type CustomHeadersParseResult =
  | { ok: true; value: Record<string, string> | null }
  | { ok: false; code: CustomHeadersValidationErrorCode; path?: string };

export const CUSTOM_HEADERS_PLACEHOLDER = JSON.stringify(
  {
    "cf-aig-authorization": "Bearer your-token",
    "x-session-id": "{{session.id}}",
    "x-client-ua": "{{header.user-agent}}",
  },
  null,
  2
);

const HTTP_TOKEN_NAME_REGEX = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const CUSTOM_HEADER_TEMPLATE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const MAX_CUSTOM_HEADER_TEMPLATE_EXPRS = 8;
const HEADER_EXPR_PREFIX = "header.";

export const PROTECTED_AUTH_HEADER_NAMES: ReadonlySet<string> = new Set([
  "authorization",
  "x-api-key",
  "x-goog-api-key",
]);

const SENSITIVE_TEMPLATE_SOURCE_HEADER_NAMES: ReadonlySet<string> = new Set([
  ...PROTECTED_AUTH_HEADER_NAMES,
  "cookie",
]);

export type CustomHeaderResolveContext = {
  getHeader: (name: string) => string | null | undefined;
  sessionId?: string | null;
  clientSessionId?: string | null;
};

type CustomHeaderExpr =
  | { kind: "header"; name: string }
  | { kind: "session"; field: "id" | "client_id" };

function hasCrlf(s: string): boolean {
  return s.indexOf("\r") !== -1 || s.indexOf("\n") !== -1;
}

function parseCustomHeaderExpr(raw: string): CustomHeaderExpr | null {
  const expr = raw.trim();
  if (!expr) return null;
  const lower = expr.toLowerCase();
  if (lower === "session.id") return { kind: "session", field: "id" };
  if (lower === "session.client_id") return { kind: "session", field: "client_id" };
  if (lower.startsWith(HEADER_EXPR_PREFIX)) {
    const name = expr.slice(HEADER_EXPR_PREFIX.length).trim();
    if (!HTTP_TOKEN_NAME_REGEX.test(name)) return null;
    if (SENSITIVE_TEMPLATE_SOURCE_HEADER_NAMES.has(name.toLowerCase())) return null;
    return { kind: "header", name };
  }
}

function matchCustomHeaderTemplates(value: string): RegExpMatchArray[] {
  return [...value.matchAll(new RegExp(CUSTOM_HEADER_TEMPLATE_RE.source, "g"))];
}

function validateCustomHeaderTemplate(value: string): CustomHeadersValidationErrorCode | null {
  const hasOpen = value.includes("{{");
  const hasClose = value.includes("}}");
  if (!hasOpen && !hasClose) return null;

  const matches = matchCustomHeaderTemplates(value);
  if (matches.length === 0) return "invalid_template";
  if (matches.length > MAX_CUSTOM_HEADER_TEMPLATE_EXPRS) return "invalid_template";

  for (const match of matches) {
    if (!parseCustomHeaderExpr(match[1] ?? "")) return "invalid_template";
  }

  const stripped = value.replace(new RegExp(CUSTOM_HEADER_TEMPLATE_RE.source, "g"), "");
  if (stripped.includes("{{") || stripped.includes("}}")) return "invalid_template";
  return null;
}

function nonempty(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value.length > 0 ? value : null;
}

function evalCustomHeaderExpr(
  expr: CustomHeaderExpr,
  ctx: CustomHeaderResolveContext
): string | null {
  if (expr.kind === "header") {
    if (SENSITIVE_TEMPLATE_SOURCE_HEADER_NAMES.has(expr.name.toLowerCase())) return null;
    return nonempty(ctx.getHeader(expr.name));
  }
  if (expr.field === "id") {
    return nonempty(ctx.sessionId);
  }
  return nonempty(ctx.clientSessionId);
}

export function resolveCustomHeaderValue(
  value: string,
  ctx: CustomHeaderResolveContext
): string | null {
  if (!value.includes("{{") && !value.includes("}}")) {
    return value;
  }

  let missing = false;
  const resolved = value.replace(new RegExp(CUSTOM_HEADER_TEMPLATE_RE.source, "g"), (_all, raw) => {
    const expr = parseCustomHeaderExpr(typeof raw === "string" ? raw : "");
    if (!expr) {
      missing = true;
      return "";
    }
    const next = evalCustomHeaderExpr(expr, ctx);
    if (next == null) {
      missing = true;
      return "";
    }
    return next;
  });

  if (missing) return null;
  if (hasCrlf(resolved)) return null;
  return nonempty(resolved);
}

export function mergeResolvedCustomHeaders(
  overrides: Record<string, string>,
  customHeaders: Record<string, string> | null | undefined,
  ctx: CustomHeaderResolveContext,
  skipNames?: ReadonlySet<string>
): void {
  if (!customHeaders) return;
  for (const [name, value] of Object.entries(customHeaders)) {
    if (typeof value !== "string") continue;
    const lower = name.toLowerCase();
    if (PROTECTED_AUTH_HEADER_NAMES.has(lower)) continue;
    if (skipNames?.has(lower)) continue;
    const resolved = resolveCustomHeaderValue(value, ctx);
    if (resolved == null) continue;
    overrides[name] = resolved;
  }
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

    const templateError = validateCustomHeaderTemplate(value);
    if (templateError) return { ok: false, code: templateError, path: name };

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
