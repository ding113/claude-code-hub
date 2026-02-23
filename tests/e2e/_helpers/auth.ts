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
  const match = new RegExp(`^${cookieName}=([^;]+)`).exec(setCookieHeader.trim());
  return match?.[1] ?? null;
}

export async function loginAndGetAuthToken(apiBaseUrl: string, key: string): Promise<string> {
  const origin = resolveAppOrigin(apiBaseUrl);

  const response = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`[e2e] login failed: ${response.status} ${text}`);
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
