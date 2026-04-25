const DEFAULT_PUBLIC_PATH_PATTERNS = [
  "/login",
  "/usage-doc",
  "/system-status",
  "/status",
  "/examples",
  "/api/auth/login",
  "/api/auth/logout",
] as const;

export function getDefaultPublicPathPatterns(): readonly string[] {
  return DEFAULT_PUBLIC_PATH_PATTERNS;
}

export function isPublicPath(pathname: string, patterns: readonly string[] = DEFAULT_PUBLIC_PATH_PATTERNS) {
  return patterns.some((pattern) => pathname === pattern || pathname.startsWith(pattern));
}
