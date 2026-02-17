const DEFAULT_REDIRECT_PATH = "/dashboard";
const PROTOCOL_LIKE_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

export function sanitizeRedirectPath(from: string): string {
  const candidate = from.trim();

  if (!candidate) {
    return DEFAULT_REDIRECT_PATH;
  }

  if (!candidate.startsWith("/")) {
    return DEFAULT_REDIRECT_PATH;
  }

  if (candidate.startsWith("//")) {
    return DEFAULT_REDIRECT_PATH;
  }

  if (PROTOCOL_LIKE_PATTERN.test(candidate)) {
    return DEFAULT_REDIRECT_PATH;
  }

  const withoutLeadingSlash = candidate.slice(1);
  if (PROTOCOL_LIKE_PATTERN.test(withoutLeadingSlash)) {
    return DEFAULT_REDIRECT_PATH;
  }

  return candidate;
}

export function resolveLoginRedirectTarget(redirectTo: unknown, from: string): string {
  if (typeof redirectTo === "string" && redirectTo.trim().length > 0) {
    return redirectTo;
  }

  return sanitizeRedirectPath(from);
}
