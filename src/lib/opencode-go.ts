// OpenCode Go adapter: detect official https://opencode.ai/* provider URLs and
// optionally inject the session header Go uses for routing and prompt caching.
// Framework-free: safe to import from the provider form, validation, and tests.

export const OPENCODE_GO_SESSION_HEADER = "x-opencode-session";
export const OPENCODE_GO_SESSION_TEMPLATE = "{{session.id}}";

export function looksLikeOpenCodeGoUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase() === "opencode.ai";
  } catch {
    return false;
  }
}

export function hasOpenCodeGoSessionHeader(
  customHeaders: Record<string, string> | null | undefined
): boolean {
  if (!customHeaders) return false;
  return Object.keys(customHeaders).some(
    (name) => name.toLowerCase() === OPENCODE_GO_SESSION_HEADER
  );
}

export function applyOpenCodeGoSessionHeader(
  customHeaders: Record<string, string> | null | undefined
): Record<string, string> {
  if (hasOpenCodeGoSessionHeader(customHeaders)) {
    return { ...(customHeaders ?? {}) };
  }
  return {
    ...(customHeaders ?? {}),
    [OPENCODE_GO_SESSION_HEADER]: OPENCODE_GO_SESSION_TEMPLATE,
  };
}

export function shouldPromptOpenCodeGoAdapter(
  url: string | null | undefined,
  customHeaders: Record<string, string> | null | undefined
): boolean {
  return looksLikeOpenCodeGoUrl(url) && !hasOpenCodeGoSessionHeader(customHeaders);
}
