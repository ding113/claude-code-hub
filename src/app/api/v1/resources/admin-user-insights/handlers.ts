/**
 * /api/v1/admin/users/{id}/insights/* handler 集合
 *
 * 4 个端点都属于 admin tier；query 参数通过 Zod schema 校验日期格式与 timeRange 取值。
 */

import type { Context } from "hono";
import {
  getUserInsightsKeyTrend,
  getUserInsightsModelBreakdown,
  getUserInsightsOverview,
  getUserInsightsProviderBreakdown,
} from "@/actions/admin-user-insights";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { problem } from "@/lib/api/v1/_shared/error-envelope";
import { respondJson } from "@/lib/api/v1/_shared/response-helpers";
import {
  type InsightsDateRangeQuery,
  InsightsDateRangeQuerySchema,
  type InsightsKeyTrendQuery,
  InsightsKeyTrendQuerySchema,
  InsightsModelBreakdownQuerySchema,
  InsightsProviderBreakdownQuerySchema,
  serializeInsightsUser,
} from "@/lib/api/v1/schemas/admin-user-insights";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

const overviewAction = getUserInsightsOverview as unknown as AnyAction;
const keyTrendAction = getUserInsightsKeyTrend as unknown as AnyAction;
const modelBreakdownAction = getUserInsightsModelBreakdown as unknown as AnyAction;
const providerBreakdownAction = getUserInsightsProviderBreakdown as unknown as AnyAction;

function parseUserIdParam(
  c: Context
): { ok: true; id: number } | { ok: false; response: Response } {
  const raw = c.req.param("id");
  const id = raw ? Number(raw) : Number.NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return {
      ok: false,
      response: problem(c, {
        status: 400,
        errorCode: "validation_failed",
        title: "Invalid path parameter",
        detail: "Path parameter `id` must be a positive integer.",
      }),
    };
  }
  return { ok: true, id };
}

// ==================== GET /admin/users/{id}/insights/overview ====================

interface OverviewData {
  user: Record<string, unknown>;
  overview: {
    requestCount: number;
    totalCost: number;
    avgResponseTime: number;
    errorRate: number;
  };
  currencyCode: string;
}

export async function getOverview(c: Context): Promise<Response> {
  const parsed = parseUserIdParam(c);
  if (!parsed.ok) return parsed.response;
  const queryResult = InsightsDateRangeQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid query",
      detail: queryResult.error.issues.map((i) => i.message).join("; "),
    });
  }
  const q: InsightsDateRangeQuery = queryResult.data;
  const result = await callAction<OverviewData>(c, overviewAction, [
    parsed.id,
    q.startDate,
    q.endDate,
  ]);
  if (!result.ok) return result.problem;
  return respondJson(
    c,
    {
      user: serializeInsightsUser(result.data.user),
      overview: result.data.overview,
      currencyCode: result.data.currencyCode,
    },
    200
  );
}

// ==================== GET /admin/users/{id}/insights/key-trend ====================

export async function getKeyTrend(c: Context): Promise<Response> {
  const parsed = parseUserIdParam(c);
  if (!parsed.ok) return parsed.response;
  const queryResult = InsightsKeyTrendQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid query",
      detail: queryResult.error.issues.map((i) => i.message).join("; "),
    });
  }
  const q: InsightsKeyTrendQuery = queryResult.data;
  const result = await callAction<unknown[]>(c, keyTrendAction, [parsed.id, q.timeRange]);
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data }, 200);
}

// ==================== GET /admin/users/{id}/insights/model-breakdown ====================

interface ModelBreakdownData {
  breakdown: Array<Record<string, unknown>>;
  currencyCode: string;
}

export async function getModelBreakdown(c: Context): Promise<Response> {
  const parsed = parseUserIdParam(c);
  if (!parsed.ok) return parsed.response;
  const queryResult = InsightsModelBreakdownQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid query",
      detail: queryResult.error.issues.map((i) => i.message).join("; "),
    });
  }
  const q = queryResult.data;
  const filters: Record<string, unknown> = {};
  if (q.keyId !== undefined) filters.keyId = q.keyId;
  if (q.providerId !== undefined) filters.providerId = q.providerId;
  const result = await callAction<ModelBreakdownData>(c, modelBreakdownAction, [
    parsed.id,
    q.startDate,
    q.endDate,
    Object.keys(filters).length > 0 ? filters : undefined,
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /admin/users/{id}/insights/provider-breakdown ====================

interface ProviderBreakdownData {
  breakdown: Array<Record<string, unknown>>;
  currencyCode: string;
}

export async function getProviderBreakdown(c: Context): Promise<Response> {
  const parsed = parseUserIdParam(c);
  if (!parsed.ok) return parsed.response;
  const queryResult = InsightsProviderBreakdownQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid query",
      detail: queryResult.error.issues.map((i) => i.message).join("; "),
    });
  }
  const q = queryResult.data;
  const filters: Record<string, unknown> = {};
  if (q.keyId !== undefined) filters.keyId = q.keyId;
  if (q.model !== undefined) filters.model = q.model;
  const result = await callAction<ProviderBreakdownData>(c, providerBreakdownAction, [
    parsed.id,
    q.startDate,
    q.endDate,
    Object.keys(filters).length > 0 ? filters : undefined,
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}
