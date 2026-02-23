function resolveAppOrigin(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/api\/actions\/?$/, "");
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

  return combined
    .split(/,(?=[^;]+?=)/g)
    .map((s) => s.trim())
    .filter(Boolean);
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
