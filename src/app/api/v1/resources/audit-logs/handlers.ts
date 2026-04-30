/**
 * /api/v1/audit-logs handler 集合
 */

import type { Context } from "hono";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { problem } from "@/lib/api/v1/_shared/error-envelope";
import { respondJson } from "@/lib/api/v1/_shared/response-helpers";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

async function loadActions() {
  const mod = await import("@/actions/audit-logs");
  return {
    list: mod.getAuditLogsBatch as unknown as AnyAction,
    detail: mod.getAuditLogDetail as unknown as AnyAction,
  };
}

interface AuditLogsBatchResult {
  rows: unknown[];
  nextCursor: unknown;
}

// ==================== GET /audit-logs ====================

export async function listAuditLogs(c: Context): Promise<Response> {
  const q = c.req.query();
  const cursorRaw = q.cursor;
  let cursor: unknown = null;
  if (cursorRaw) {
    try {
      cursor = JSON.parse(decodeURIComponent(cursorRaw));
    } catch {
      // ignore malformed cursor; treat as null
    }
  }
  const limit = q.limit ? Number(q.limit) : undefined;

  const filter: { category?: string; success?: boolean; from?: string; to?: string } = {};
  if (q.category) filter.category = q.category;
  if (q.success === "true") filter.success = true;
  else if (q.success === "false") filter.success = false;
  if (q.from) filter.from = q.from;
  if (q.to) filter.to = q.to;

  const input = {
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    cursor,
    pageSize: Number.isFinite(limit) ? limit : undefined,
  };

  const actions = await loadActions();
  const result = await callAction<AuditLogsBatchResult>(c, actions.list, [input]);
  if (!result.ok) return result.problem;
  return respondJson(
    c,
    {
      items: result.data.rows ?? [],
      pageInfo: {
        nextCursor: result.data.nextCursor,
        hasMore: Boolean(result.data.nextCursor),
      },
    },
    200
  );
}

// ==================== GET /audit-logs/{id} ====================

export async function getAuditLogDetail(c: Context): Promise<Response> {
  const idRaw = c.req.param("id");
  const id = idRaw ? Number(idRaw) : Number.NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid path parameter",
      detail: "Path parameter `id` must be a positive integer.",
    });
  }
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.detail, [id]);
  if (!result.ok) return result.problem;
  if (result.data == null) {
    return problem(c, {
      status: 404,
      errorCode: "not_found",
      title: "Not Found",
      detail: `Audit log ${id} does not exist.`,
    });
  }
  return respondJson(c, result.data, 200);
}
