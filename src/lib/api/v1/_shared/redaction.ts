const SECRET_HEADER_NAMES = new Set(["authorization", "x-api-key", "cookie", "set-cookie"]);
const SECRET_HEADER_NAME_PATTERNS = [
  /authorization/i,
  /api[-_]?key/i,
  /cookie/i,
  /token/i,
  /secret/i,
  /password/i,
];
const URL_CREDENTIAL_REDACTION = "REDACTED";

export function redactSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return "[REDACTED]";
  return `${value.slice(0, 4)}...[REDACTED]...${value.slice(-4)}`;
}

export function redactHeaders(headers: Headers): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    const normalizedName = name.toLowerCase();
    redacted[normalizedName] = isSecretHeaderName(normalizedName) ? "[REDACTED]" : value;
  }
  return redacted;
}

export function redactHeaderRecord(
  headers: Record<string, string> | null | undefined
): Record<string, string> | null {
  if (!headers) return null;
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      isSecretHeaderName(name) ? "[REDACTED]" : value,
    ])
  );
}

export function redactUrlCredentials(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    parsed.username = URL_CREDENTIAL_REDACTION;
    parsed.password = URL_CREDENTIAL_REDACTION;
    return parsed.toString();
  } catch {
    return url;
  }
}

function isSecretHeaderName(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return (
    SECRET_HEADER_NAMES.has(normalizedName) ||
    SECRET_HEADER_NAME_PATTERNS.some((pattern) => pattern.test(normalizedName))
  );
}
