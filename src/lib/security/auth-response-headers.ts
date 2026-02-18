import type { NextResponse } from "next/server";
import { withNoStoreHeaders } from "@/lib/auth";
import { getEnvConfig } from "@/lib/config/env.schema";
import { buildSecurityHeaders } from "@/lib/security/security-headers";

export function applySecurityHeaders(response: NextResponse): NextResponse {
  const env = getEnvConfig();
  const headers = buildSecurityHeaders({
    enableHsts: env.ENABLE_SECURE_COOKIES,
    cspMode: "report-only",
  });

  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  return response;
}

export function withAuthResponseHeaders(response: NextResponse): NextResponse {
  return applySecurityHeaders(withNoStoreHeaders(response));
}
