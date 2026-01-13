export function normalizeVendorKeyFromUrl(rawUrl: string): string | null {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch {
    return null;
  }
}
