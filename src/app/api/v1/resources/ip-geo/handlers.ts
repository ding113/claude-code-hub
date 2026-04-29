/**
 * /api/v1/ip-geo handler 集合
 *
 * read tier；委托给现有 /api/ip-geo/[ip] 路由（admin-only inside）。
 * 当 ipGeoLookupEnabled=false 时透传 404。
 */

import type { Context } from "hono";
import { problem } from "@/lib/api/v1/_shared/error-envelope";

export async function getIpGeo(c: Context): Promise<Response> {
  const ip = c.req.param("ip");
  if (!ip) {
    return problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid path parameter",
      detail: "Path parameter `ip` is required.",
    });
  }
  const lang = c.req.query("lang");
  // Reuse existing /api/ip-geo/[ip] handler — that route checks admin/auth.
  const route = await import("@/app/api/ip-geo/[ip]/route");
  const search = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  const url = new URL(c.req.url);
  const proxied = new Request(`${url.origin}/api/ip-geo/${encodeURIComponent(ip)}${search}`, {
    method: "GET",
    headers: c.req.raw.headers,
  });
  return route.GET(proxied, { params: Promise.resolve({ ip }) });
}
