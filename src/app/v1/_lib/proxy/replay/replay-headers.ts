const REPLAY_EXCLUDED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function captureReplayResponseHeaders(
  source: Headers,
  fallbackContentType?: string
): Record<string, string> {
  const captured: Record<string, string> = {};
  source.forEach((value, name) => {
    const normalizedName = name.toLowerCase();
    if (!REPLAY_EXCLUDED_RESPONSE_HEADERS.has(normalizedName)) {
      captured[normalizedName] = value;
    }
  });
  if (fallbackContentType && !captured["content-type"]) {
    captured["content-type"] = fallbackContentType;
  }
  return captured;
}

export function restoreReplayResponseHeaders(stored: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(stored)) {
    const normalizedName = name.toLowerCase();
    if (!REPLAY_EXCLUDED_RESPONSE_HEADERS.has(normalizedName)) {
      headers.set(normalizedName, value);
    }
  }
  return headers;
}
