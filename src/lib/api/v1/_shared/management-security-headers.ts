import { getEnvConfig } from "@/lib/config/env.schema";
import { buildSecurityHeaders } from "@/lib/security/security-headers";

export function applyManagementSecurityHeaders(headers: Headers): Headers {
  const securityHeaders = buildSecurityHeaders({
    enableHsts: getEnvConfig().ENABLE_SECURE_COOKIES,
    cspMode: "report-only",
    frameOptions: "DENY",
  });

  for (const [key, value] of Object.entries(securityHeaders)) {
    headers.set(key, value);
  }
  headers.set("Cache-Control", "no-store");
  return headers;
}

export function withManagementSecurityHeaders(response: Response): Response {
  const headers = applyManagementSecurityHeaders(new Headers(response.headers));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
