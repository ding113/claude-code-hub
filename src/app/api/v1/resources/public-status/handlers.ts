/**
 * /api/v1/public/status handler 集合
 *
 * GET /api/v1/public/status - 完全公开，复用现有 /api/public-status 实现；
 * PUT /api/v1/public/status/settings - admin + CSRF；调用 savePublicStatusSettings。
 */

import type { Context } from "hono";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import { respondJson } from "@/lib/api/v1/_shared/response-helpers";
import { PublicStatusSettingsRequestSchema } from "@/lib/api/v1/schemas/public-status";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

async function loadPublicStatusAction(): Promise<AnyAction> {
  const mod = await import("@/actions/public-status");
  return mod.savePublicStatusSettings as unknown as AnyAction;
}

// ==================== GET /api/v1/public/status ====================

export async function getPublicStatus(c: Context): Promise<Response> {
  // Reuse the existing /api/public-status route handler
  const route = await import("@/app/api/public-status/route");
  // Forward the original request to the legacy GET handler
  const url = new URL(c.req.url);
  // Strip the /api/v1 prefix → /api/public-status (preserve query string)
  const proxied = new Request(`${url.origin}/api/public-status${url.search}`, {
    method: "GET",
    headers: c.req.raw.headers,
  });
  return route.GET(proxied);
}

// ==================== PUT /api/v1/public/status/settings ====================

export async function updatePublicStatusSettings(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof PublicStatusSettingsRequestSchema>(
    c,
    PublicStatusSettingsRequestSchema,
    { strict: false }
  );
  if (!body.ok) return body.response;
  const action = await loadPublicStatusAction();
  const result = await callAction<unknown>(c, action, [body.data]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}
