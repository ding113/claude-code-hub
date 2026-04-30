/**
 * /api/v1/me handler 集合
 *
 * 全部 read tier；action 内自身做 session.user.id 限定（self-scoped）。
 */

import type { Context } from "hono";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { problem } from "@/lib/api/v1/_shared/error-envelope";
import { respondJson } from "@/lib/api/v1/_shared/response-helpers";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

async function loadMyUsageActions() {
  const mod = await import("@/actions/my-usage");
  return {
    metadata: mod.getMyUsageMetadata as unknown as AnyAction,
    quota: mod.getMyQuota as unknown as AnyAction,
    today: mod.getMyTodayStats as unknown as AnyAction,
    logsBatch: mod.getMyUsageLogsBatch as unknown as AnyAction,
    logsBatchFull: mod.getMyUsageLogsBatchFull as unknown as AnyAction,
    models: mod.getMyAvailableModels as unknown as AnyAction,
    endpoints: mod.getMyAvailableEndpoints as unknown as AnyAction,
    statsSummary: mod.getMyStatsSummary as unknown as AnyAction,
    ipGeo: mod.getMyIpGeoDetails as unknown as AnyAction,
  };
}

function parseFiltersFromQuery(c: Context): Record<string, unknown> {
  const q = c.req.query();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    if (k === "cursor" || k === "limit") continue;
    if (k === "statusCode" || k === "minRetryCount") {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    } else if (k === "excludeStatusCode200") {
      out[k] = v === "true";
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ==================== GET /me/metadata ====================

export async function getMetadata(c: Context): Promise<Response> {
  const actions = await loadMyUsageActions();
  const result = await callAction<unknown>(c, actions.metadata, [], {
    allowReadOnlyAccess: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /me/quota ====================

export async function getQuota(c: Context): Promise<Response> {
  const actions = await loadMyUsageActions();
  const result = await callAction<unknown>(c, actions.quota, [], {
    allowReadOnlyAccess: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /me/today ====================

export async function getToday(c: Context): Promise<Response> {
  const actions = await loadMyUsageActions();
  const result = await callAction<unknown>(c, actions.today, [], {
    allowReadOnlyAccess: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /me/usage-logs ====================

export async function getUsageLogsList(c: Context): Promise<Response> {
  const q = c.req.query();
  const limit = q.limit ? Math.max(1, Math.min(100, Number(q.limit))) : 20;
  const filters = parseFiltersFromQuery(c);

  let cursor: { createdAt: string; id: number } | undefined;
  if (q.cursor) {
    try {
      const decoded = Buffer.from(q.cursor, "base64url").toString("utf8");
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed.createdAt === "string" && Number.isInteger(parsed.id)) {
        cursor = parsed;
      }
    } catch {
      return problem(c, {
        status: 400,
        errorCode: "validation_failed",
        title: "Invalid cursor",
        detail: "Cursor must be a base64url-encoded JSON object with createdAt and id.",
      });
    }
  }

  const actions = await loadMyUsageActions();
  const result = await callAction<{
    logs: unknown[];
    nextCursor: { createdAt: string; id: number } | null;
    hasMore: boolean;
  }>(c, actions.logsBatch, [{ ...filters, cursor, limit }], {
    allowReadOnlyAccess: true,
  });
  if (!result.ok) return result.problem;
  const next = result.data.nextCursor
    ? Buffer.from(JSON.stringify(result.data.nextCursor), "utf8").toString("base64url")
    : null;
  return respondJson(
    c,
    {
      logs: result.data.logs ?? [],
      nextCursor: next,
      hasMore: Boolean(result.data.hasMore),
    },
    200
  );
}

// ==================== GET /me/usage-logs/full ====================

export async function getUsageLogsFull(c: Context): Promise<Response> {
  const filters = parseFiltersFromQuery(c);
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  const actions = await loadMyUsageActions();
  const result = await callAction<unknown>(c, actions.logsBatchFull, [{ ...filters, limit }], {
    allowReadOnlyAccess: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /me/usage-logs/models ====================

export async function getModels(c: Context): Promise<Response> {
  const actions = await loadMyUsageActions();
  const result = await callAction<string[]>(c, actions.models, [], {
    allowReadOnlyAccess: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data ?? [] }, 200);
}

// ==================== GET /me/usage-logs/endpoints ====================

export async function getEndpoints(c: Context): Promise<Response> {
  const actions = await loadMyUsageActions();
  const result = await callAction<string[]>(c, actions.endpoints, [], {
    allowReadOnlyAccess: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data ?? [] }, 200);
}

// ==================== GET /me/usage-logs/stats-summary ====================

export async function getStatsSummary(c: Context): Promise<Response> {
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  const actions = await loadMyUsageActions();
  const result = await callAction<unknown>(c, actions.statsSummary, [{ startDate, endDate }], {
    allowReadOnlyAccess: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /me/ip-geo/{ip} ====================

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
  const actions = await loadMyUsageActions();
  const result = await callAction<unknown>(c, actions.ipGeo, [{ ip, lang }], {
    allowReadOnlyAccess: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}
