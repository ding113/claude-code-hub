export function isJsonResponseContentType(contentType: string | null): boolean {
  if (!contentType) return false;

  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

export function isMalformedJsonResponseBody(contentType: string | null, body: string): boolean {
  if (!isJsonResponseContentType(contentType)) return false;

  try {
    JSON.parse(body);
    return false;
  } catch {
    return true;
  }
}
