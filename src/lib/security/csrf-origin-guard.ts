export interface CsrfGuardConfig {
  allowedOrigins: string[];
  allowSameOrigin: boolean;
  enforceInDevelopment: boolean;
  /** Trust X-Forwarded-Host header for origin comparison (default: false).
   *  Only enable when deployed behind a trusted reverse proxy that strips
   *  client-provided X-Forwarded-Host before setting its own. */
  trustForwardedHost?: boolean;
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
  return origin.trim().toLowerCase();
}

function isDevelopmentRuntime(): boolean {
  if (typeof process === "undefined") return false;
  return process.env.NODE_ENV === "development";
}

/**
 * Extract the effective host from request headers.
 * Only uses X-Forwarded-Host when explicitly trusted; otherwise falls back to Host.
 */
function resolveEffectiveHost(
  request: CsrfGuardRequest,
  trustForwardedHost: boolean,
): string | null {
  if (trustForwardedHost) {
    const forwarded = request.headers.get("x-forwarded-host")?.trim().toLowerCase();
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
  }
  return request.headers.get("host")?.trim().toLowerCase() ?? null;
}

/**
 * Compare Origin header against Host header (standard CSRF fallback).
 * Extracts host:port from the Origin URL and compares with the request host.
 */
function isOriginMatchingHost(origin: string, host: string): boolean {
  try {
    const url = new URL(origin);
    return url.host === host;
  } catch {
    return false;
  }
}

export function createCsrfOriginGuard(config: CsrfGuardConfig) {
  const allowSameOrigin = config.allowSameOrigin ?? true;
  const enforceInDevelopment = config.enforceInDevelopment ?? false;
  const trustForwardedHost = config.trustForwardedHost ?? false;
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

      // Fallback: compare Origin against Host header (standard CSRF technique).
      // Handles cases where sec-fetch-site is absent (reverse proxy stripping,
      // older browsers) but the request is genuinely same-origin.
      if (allowSameOrigin) {
        const host = resolveEffectiveHost(request, trustForwardedHost);
        if (host && isOriginMatchingHost(origin, host)) {
          return { allowed: true };
        }
      }

      if (allowedOrigins.has(origin)) {
        return { allowed: true };
      }

      return { allowed: false, reason: `Origin ${origin} not in allowlist` };
    },
  };
}
