export interface CsrfGuardConfig {
  allowedOrigins: string[];
  allowSameOrigin: boolean;
  enforceInDevelopment: boolean;
}

export interface CsrfGuardResult {
  allowed: boolean;
  reason?: string;
}

export interface CsrfGuardRequest {
  headers: {
    get(name: string): string | null;
  };
}

function normalizeOrigin(origin: string): string {
  return origin.trim();
}

function isDevelopmentRuntime(): boolean {
  if (typeof process === "undefined") return false;
  return process.env.NODE_ENV === "development";
}

export function createCsrfOriginGuard(config: CsrfGuardConfig) {
  const allowSameOrigin = config.allowSameOrigin ?? true;
  const enforceInDevelopment = config.enforceInDevelopment ?? false;
  const allowedOrigins = new Set(
    (config.allowedOrigins ?? []).map(normalizeOrigin).filter((origin) => origin.length > 0)
  );

  return {
    check(request: CsrfGuardRequest): CsrfGuardResult {
      if (isDevelopmentRuntime() && !enforceInDevelopment) {
        return { allowed: true, reason: "csrf_guard_bypassed_in_development" };
      }

      const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase() ?? null;
      if (fetchSite === "same-origin" && allowSameOrigin) {
        return { allowed: true };
      }

      const originValue = request.headers.get("origin");
      const origin = originValue ? normalizeOrigin(originValue) : null;

      if (!origin) {
        if (fetchSite === "cross-site") {
          return {
            allowed: false,
            reason: "Cross-site request blocked: missing Origin header",
          };
        }

        return { allowed: true };
      }

      if (allowedOrigins.has(origin)) {
        return { allowed: true };
      }

      return { allowed: false, reason: `Origin ${origin} not in allowlist` };
    },
  };
}
