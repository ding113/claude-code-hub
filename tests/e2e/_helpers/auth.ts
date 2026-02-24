function resolveAppOrigin(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/api\/actions\/?$/, "");
}

export function splitSetCookieHeader(combined: string): string[] {
  const cookies: string[] = [];
  let start = 0;
  let inExpires = false;
  let inQuotes = false;
  let escapeNext = false;

  function isExpiresStart(index: number): boolean {
    if (combined.slice(index, index + 8).toLowerCase() !== "expires=") return false;
    if (index === 0) return true;
    const prev = combined[index - 1];
    return prev === ";" || prev === " " || prev === "\t";
  }

  for (let i = 0; i < combined.length; i++) {
    const ch = combined[i];

    if (inQuotes) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === "\\") {
        escapeNext = true;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (!inExpires && isExpiresStart(i)) {
      inExpires = true;
      i += 7;
      continue;
    }

    if (inExpires && ch === ";") {
      inExpires = false;
      continue;
    }

    if (ch !== ",") continue;

    const next = combined.slice(i + 1);
    const looksLikeCookieStart = /^\s*[^;\s]+=/.test(next);
    if (!looksLikeCookieStart) {
      continue;
    }

    const part = combined.slice(start, i).trim();
    if (part) {
      cookies.push(part);
    }
    start = i + 1;
    inExpires = false;
  }

  const last = combined.slice(start).trim();
  if (last) {
    cookies.push(last);
  }

  return cookies;
}

function getSetCookieHeaders(response: Response): string[] {
  const headersWithGetSetCookie = response.headers as unknown as {
    getSetCookie?: () => string[];
  };

  const headerList = headersWithGetSetCookie.getSetCookie?.();
  if (Array.isArray(headerList) && headerList.length > 0) {
    return headerList;
  }

  const combined = response.headers.get("set-cookie");
  if (!combined) return [];

  return splitSetCookieHeader(combined);
}

function extractCookieValue(setCookieHeader: string, cookieName: string): string | null {
  const trimmed = setCookieHeader.trim();
  if (!trimmed) return null;

  const segments = trimmed.split(";");
  for (const segment of segments) {
    const part = segment.trim();
    if (!part) continue;

    if (part.startsWith(`${cookieName}=`)) {
      return part.slice(cookieName.length + 1) || null;
    }
  }

  return null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const retryCodes = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_SOCKET",
  ]);

  const errorWithCause = error as { cause?: unknown; code?: unknown };
  const maybeCodes: string[] = [];
  if (typeof errorWithCause.code === "string") {
    maybeCodes.push(errorWithCause.code);
  }

  const cause = errorWithCause.cause;
  if (cause && typeof cause === "object") {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === "string") {
      maybeCodes.push(causeCode);
    }
  }

  if (maybeCodes.length > 0) {
    return maybeCodes.some((code) => retryCodes.has(code));
  }

  const message = error.message.toLowerCase();
  return message.includes("fetch failed");
}

export async function loginAndGetAuthToken(apiBaseUrl: string, key: string): Promise<string> {
  const origin = resolveAppOrigin(apiBaseUrl);

  const url = `${origin}/api/auth/login`;
  const maxAttempts = 10;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
    } catch (error) {
      lastError = error;
      if (!shouldRetryFetchError(error)) {
        break;
      }
      if (attempt >= maxAttempts) {
        break;
      }

      await sleep(Math.min(1000, 100 * 2 ** (attempt - 1)));
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const errorCode = (() => {
        try {
          const parsed = JSON.parse(text) as { errorCode?: unknown };
          return typeof parsed?.errorCode === "string" ? parsed.errorCode : undefined;
        } catch {
          return undefined;
        }
      })();

      const error = new Error(`[e2e] login failed: ${response.status} ${text}`);
      const shouldRetry = response.status === 503 && errorCode === "SESSION_CREATE_FAILED";

      if (!shouldRetry) {
        throw error;
      }

      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }

      await sleep(Math.min(1000, 100 * 2 ** (attempt - 1)));
      continue;
    }

    const setCookieHeaders = getSetCookieHeaders(response);
    const authToken = setCookieHeaders
      .map((header) => extractCookieValue(header, "auth-token"))
      .find((value): value is string => Boolean(value));

    if (!authToken) {
      throw new Error("[e2e] login succeeded but auth-token cookie is missing");
    }

    return authToken;
  }

  throw lastError instanceof Error ? lastError : new Error("[e2e] login failed");
}
