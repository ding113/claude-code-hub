/**
 * /api/v1/usage-logs handler 集合
 */

import type { Context } from "hono";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { setNoStore } from "@/lib/api/v1/_shared/cache-control";
import { problem } from "@/lib/api/v1/_shared/error-envelope";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import { respondAccepted, respondJson } from "@/lib/api/v1/_shared/response-helpers";
import { UsageLogsExportRequestSchema } from "@/lib/api/v1/schemas/usage-logs";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

async function loadActions() {
  const mod = await import("@/actions/usage-logs");
  return {
    list: mod.getUsageLogs as unknown as AnyAction,
    listBatch: mod.getUsageLogsBatch as unknown as AnyAction,
    stats: mod.getUsageLogsStats as unknown as AnyAction,
    filterOptions: mod.getFilterOptions as unknown as AnyAction,
    sessionIdSuggest: mod.getUsageLogSessionIdSuggestions as unknown as AnyAction,
    exportSync: mod.exportUsageLogs as unknown as AnyAction,
    exportStart: mod.startUsageLogsExport as unknown as AnyAction,
    exportStatus: mod.getUsageLogsExportStatus as unknown as AnyAction,
    exportDownload: mod.downloadUsageLogsExport as unknown as AnyAction,
  };
}

function parseFiltersFromQuery(c: Context): Record<string, unknown> {
  const q = c.req.query();
  const out: Record<string, unknown> = {};
  // Pass-through any non-pagination filter
  for (const [k, v] of Object.entries(q)) {
    if (k === "cursor" || k === "limit" || k === "page" || k === "pageSize") continue;
    if (
      k === "statusCode" ||
      k === "minRetryCount" ||
      k === "userId" ||
      k === "keyId" ||
      k === "providerId"
    ) {
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

// ==================== GET /usage-logs ====================

export async function listUsageLogs(c: Context): Promise<Response> {
  const q = c.req.query();
  const cursor = q.cursor;
  const limit = q.limit ? Math.max(1, Math.min(100, Number(q.limit))) : 20;
  const filters = parseFiltersFromQuery(c);

  const actions = await loadActions();

  if (cursor !== undefined && cursor !== "") {
    // cursor-based: use getUsageLogsBatch
    let cursorPayload: { createdAt: string; id: number } | undefined;
    try {
      const decoded = Buffer.from(cursor, "base64url").toString("utf8");
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed.createdAt === "string" && Number.isInteger(parsed.id)) {
        cursorPayload = parsed;
      }
    } catch {
      return problem(c, {
        status: 400,
        errorCode: "validation_failed",
        title: "Invalid cursor",
        detail: "Cursor must be a base64url-encoded JSON object with createdAt and id.",
      });
    }
    const result = await callAction<{
      logs: unknown[];
      nextCursor: { createdAt: string; id: number } | null;
      hasMore: boolean;
    }>(c, actions.listBatch, [{ ...filters, cursor: cursorPayload, limit }]);
    if (!result.ok) return result.problem;
    const next = result.data.nextCursor
      ? Buffer.from(JSON.stringify(result.data.nextCursor), "utf8").toString("base64url")
      : null;
    return respondJson(
      c,
      {
        items: result.data.logs ?? [],
        pageInfo: { nextCursor: next, hasMore: Boolean(result.data.hasMore), limit },
      },
      200
    );
  }

  // No cursor: use getUsageLogsBatch with no cursor (treat as first page)
  const result = await callAction<{
    logs: unknown[];
    nextCursor: { createdAt: string; id: number } | null;
    hasMore: boolean;
  }>(c, actions.listBatch, [{ ...filters, limit }]);
  if (!result.ok) return result.problem;
  const next = result.data.nextCursor
    ? Buffer.from(JSON.stringify(result.data.nextCursor), "utf8").toString("base64url")
    : null;
  return respondJson(
    c,
    {
      items: result.data.logs ?? [],
      pageInfo: { nextCursor: next, hasMore: Boolean(result.data.hasMore), limit },
    },
    200
  );
}

// ==================== GET /usage-logs/stats ====================

export async function getUsageLogsStats(c: Context): Promise<Response> {
  const filters = parseFiltersFromQuery(c);
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.stats, [filters]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /usage-logs/filter-options ====================

export async function getUsageLogsFilterOptions(c: Context): Promise<Response> {
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.filterOptions, []);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /usage-logs/session-id-suggestions ====================

export async function getSessionIdSuggestions(c: Context): Promise<Response> {
  const q = c.req.query();
  const term = q.q ?? "";
  const userId = q.userId ? Number(q.userId) : undefined;
  const keyId = q.keyId ? Number(q.keyId) : undefined;
  const providerId = q.providerId ? Number(q.providerId) : undefined;
  const actions = await loadActions();
  const result = await callAction<string[]>(c, actions.sessionIdSuggest, [
    { term, userId, keyId, providerId },
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data ?? [] }, 200);
}

// ==================== POST /usage-logs/exports ====================

export async function startOrSyncExport(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof UsageLogsExportRequestSchema>(
    c,
    UsageLogsExportRequestSchema,
    { strict: false }
  );
  if (!body.ok) return body.response;
  const filters = (body.data as { filters?: Record<string, unknown> }).filters ?? {};

  const actions = await loadActions();
  const prefer = (c.req.header("prefer") ?? "").toLowerCase();
  const isAsync = prefer.includes("respond-async");

  if (isAsync) {
    const result = await callAction<{ jobId: string }>(c, actions.exportStart, [filters]);
    if (!result.ok) return result.problem;
    setNoStore(c);
    return respondAccepted(c, {
      jobId: result.data.jobId,
      status: "queued",
      statusUrl: `/api/v1/usage-logs/exports/${result.data.jobId}`,
    });
  }

  // sync mode: returns CSV string
  const result = await callAction<string>(c, actions.exportSync, [filters]);
  if (!result.ok) return result.problem;
  return new Response(result.data, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="usage-logs.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

// ==================== GET /usage-logs/exports/{jobId} ====================

export async function getExportStatus(c: Context): Promise<Response> {
  const jobId = c.req.param("jobId");
  if (!jobId) {
    return problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid path parameter",
      detail: "Path parameter `jobId` is required.",
    });
  }
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.exportStatus, [jobId]);
  if (!result.ok) return result.problem;
  setNoStore(c);
  return respondJson(c, result.data, 200);
}

// ==================== GET /usage-logs/exports/{jobId}/download ====================

export async function downloadExport(c: Context): Promise<Response> {
  const jobId = c.req.param("jobId");
  if (!jobId) {
    return problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid path parameter",
      detail: "Path parameter `jobId` is required.",
    });
  }
  const actions = await loadActions();
  const result = await callAction<string>(c, actions.exportDownload, [jobId]);
  if (!result.ok) return result.problem;
  return new Response(result.data, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="usage-logs-${jobId}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
