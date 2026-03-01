export interface SecurityHeadersConfig {
  enableHsts: boolean;
  cspMode: "report-only" | "enforce" | "disabled";
  cspReportUri?: string;
  hstsMaxAge: number;
  frameOptions: "DENY" | "SAMEORIGIN";
}

export const DEFAULT_SECURITY_HEADERS_CONFIG: SecurityHeadersConfig = {
  enableHsts: false,
  cspMode: "report-only",
  hstsMaxAge: 31536000,
  frameOptions: "DENY",
};

function isValidCspReportUri(uri: string): boolean {
  const trimmed = uri.trim();
  if (!trimmed || trimmed.includes(";") || trimmed.includes(",") || /\s/.test(trimmed)) {
    return false;
  }
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

const DEFAULT_CSP_VALUE =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' " +
  "'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; " +
  "frame-ancestors 'none'";

export function buildSecurityHeaders(
  config?: Partial<SecurityHeadersConfig>
): Record<string, string> {
  const merged = { ...DEFAULT_SECURITY_HEADERS_CONFIG, ...config };
  const headers: Record<string, string> = {};

  headers["X-Content-Type-Options"] = "nosniff";
  headers["X-Frame-Options"] = merged.frameOptions;
  headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
  headers["X-DNS-Prefetch-Control"] = "off";

  if (merged.enableHsts) {
    headers["Strict-Transport-Security"] = `max-age=${merged.hstsMaxAge}; includeSubDomains`;
  }

  if (merged.cspMode !== "disabled") {
    const headerName =
      merged.cspMode === "report-only"
        ? "Content-Security-Policy-Report-Only"
        : "Content-Security-Policy";

    if (merged.cspReportUri && isValidCspReportUri(merged.cspReportUri)) {
      headers[headerName] = `${DEFAULT_CSP_VALUE}; report-uri ${merged.cspReportUri}`;
    } else {
      headers[headerName] = DEFAULT_CSP_VALUE;
    }
  }

  return headers;
}
