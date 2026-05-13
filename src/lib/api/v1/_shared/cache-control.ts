export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
} as const;

export function withNoStoreHeaders(headers = new Headers()): Headers {
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) {
    headers.set(key, value);
  }
  return headers;
}
