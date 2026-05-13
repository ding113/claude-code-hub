import type { Context } from "hono";
import type { ActionResult } from "@/actions/types";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import {
  createProblemResponse,
  fromZodError,
  publicActionErrorDetail,
} from "@/lib/api/v1/_shared/error-envelope";
import { decodeCursor, encodeCursor } from "@/lib/api/v1/_shared/pagination";
import { jsonResponse } from "@/lib/api/v1/_shared/response-helpers";
import {
  AuditLogIdParamSchema,
  type AuditLogListQuery,
  AuditLogListQuerySchema,
} from "@/lib/api/v1/schemas/audit-logs";

export async function listAuditLogs(c: Context): Promise<Response> {
  const query = AuditLogListQuerySchema.safeParse({
    cursor: c.req.query("cursor"),
    limit: c.req.query("limit"),
    category: c.req.query("category"),
    success: c.req.query("success"),
    from: c.req.query("from"),
    to: c.req.query("to"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const cursor = parseAuditCursor(c, query.data.cursor);
  if (cursor instanceof Response) return cursor;

  const actions = await import("@/actions/audit-logs");
  const result = await callAction(
    c,
    actions.getAuditLogsBatch,
    [toActionInput(query.data, cursor)] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);

  return jsonResponse({
    items: result.data.rows,
    pageInfo: {
      nextCursor: result.data.nextCursor
        ? encodeCursor({
            createdAt: result.data.nextCursor.createdAt,
            id: result.data.nextCursor.id,
          })
        : null,
      hasMore: Boolean(result.data.nextCursor),
      limit: query.data.limit,
    },
  });
}

export async function getAuditLog(c: Context): Promise<Response> {
  const params = AuditLogIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/audit-logs");
  const result = await callAction(
    c,
    actions.getAuditLogDetail,
    [params.data.id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  if (!result.data) {
    return createProblemResponse({
      status: 404,
      instance: new URL(c.req.url).pathname,
      errorCode: "audit_log.not_found",
      detail: "Audit log was not found.",
    });
  }
  return jsonResponse(result.data);
}

function parseAuditCursor(
  c: Context,
  cursor?: string
): { createdAt: string; id: number } | null | Response {
  if (!cursor) return null;
  const decoded = decodeCursor(cursor);
  if (
    !decoded ||
    typeof decoded.createdAt !== "string" ||
    typeof decoded.id !== "number" ||
    !Number.isInteger(decoded.id)
  ) {
    return createProblemResponse({
      status: 400,
      instance: new URL(c.req.url).pathname,
      errorCode: "audit_log.invalid_cursor",
      detail: "Cursor is invalid.",
    });
  }
  return { createdAt: decoded.createdAt, id: decoded.id };
}

function toActionInput(query: AuditLogListQuery, cursor: { createdAt: string; id: number } | null) {
  return {
    filter: {
      category: query.category,
      success: query.success,
      from: query.from,
      to: query.to,
    },
    cursor,
    pageSize: query.limit,
  };
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const status = result.errorCode === "PERMISSION_DENIED" || detail.includes("权限") ? 403 : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: result.errorCode ?? "audit_log.action_failed",
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
