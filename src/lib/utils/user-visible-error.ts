const DATABASE_DETAIL_MARKER = /\b(query|sql|statement|params?|result|rows?)\s*[:=]/i;
const DATABASE_ERROR_PREFIX =
  /\b(?:db\s+query\s+error|database\s+query\s+error|postgres(?:ql)?\s+error|sql\s+error)\b/i;
const SQL_DETAIL_AFTER_MARKER = /\b(query|sql|statement)\s*[:=]\s*(select|insert|update|delete)\b/i;
const STRUCTURED_DETAIL_VALUE = /\b(result|rows?|params?)\s*[:=]\s*[[{(]/i;
const API_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|secret|password|token)\b(\s*[:=]\s*)([^,\s;)}\]]+)/gi;
const DEFAULT_SAFE_ERROR_MESSAGE = "Operation failed";

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

function redactSecrets(message: string): string {
  return message
    .replace(API_KEY_PATTERN, "[REDACTED]")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [REDACTED]")
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, key: string, separator: string) => {
      return `${key}${separator}[REDACTED]`;
    });
}

function hasStructuredDatabasePayload(message: string): boolean {
  return (
    SQL_DETAIL_AFTER_MARKER.test(message) ||
    (DATABASE_ERROR_PREFIX.test(message) &&
      (DATABASE_DETAIL_MARKER.test(message) || STRUCTURED_DETAIL_VALUE.test(message)))
  );
}

function stripStructuredDatabasePayload(message: string): string {
  const markerMatch = message.match(DATABASE_DETAIL_MARKER);
  const cutIndexCandidates = [markerMatch?.index].filter(
    (value): value is number => typeof value === "number" && value >= 0
  );

  if (cutIndexCandidates.length === 0) {
    return message;
  }

  const cutIndex = Math.min(...cutIndexCandidates);
  return message
    .slice(0, cutIndex)
    .replace(/[\s:;,-]+$/g, "")
    .trim();
}

export function sanitizeUserVisibleErrorMessage(message: string): string {
  const sanitized = normalizeMessage(redactSecrets(message));

  if (!sanitized) {
    return sanitized;
  }

  if (!hasStructuredDatabasePayload(sanitized)) {
    return sanitized;
  }

  return stripStructuredDatabasePayload(sanitized);
}

export function getSafeErrorToastMessage(message: string, fallback: string): string {
  const sanitized = sanitizeUserVisibleErrorMessage(message);

  if (!sanitized) {
    return fallback;
  }

  return hasStructuredDatabasePayload(message) ? fallback : sanitized;
}

function sanitizeToastText(message: string): string {
  const sanitized = sanitizeUserVisibleErrorMessage(message);

  return sanitized || DEFAULT_SAFE_ERROR_MESSAGE;
}

type ToastLike<TArgs extends unknown[] = unknown[]> = {
  error: (...args: TArgs) => unknown;
  __cchErrorSanitizerInstalled__?: boolean;
};

export function installErrorToastSanitizer<TArgs extends unknown[]>(
  toastApi: ToastLike<TArgs>
): void {
  if (toastApi.__cchErrorSanitizerInstalled__) {
    return;
  }

  const originalError = toastApi.error.bind(toastApi);

  toastApi.error = ((...args: TArgs) => {
    const [message, ...rest] = args;
    const safeMessage = typeof message === "string" ? sanitizeToastText(message) : message;
    const safeRest = rest.map((value, index) => {
      if (
        index === 0 &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof (value as { description?: unknown }).description === "string"
      ) {
        return {
          ...value,
          description: sanitizeToastText((value as { description: string }).description),
        };
      }

      return value;
    });
    const safeArgs = [safeMessage, ...safeRest] as TArgs;

    return originalError(...safeArgs);
  }) as ToastLike<TArgs>["error"];
  toastApi.__cchErrorSanitizerInstalled__ = true;
}
