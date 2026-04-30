/**
 * /api/v1/dashboard handler 集合
 */

import type { Context } from "hono";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import { respondJson } from "@/lib/api/v1/_shared/response-helpers";
import { DispatchSimulatorRequestSchema } from "@/lib/api/v1/schemas/dashboard";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

async function loadOverviewAction(): Promise<AnyAction> {
  const mod = await import("@/actions/overview");
  return mod.getOverviewData as unknown as AnyAction;
}

async function loadRealtimeAction(): Promise<AnyAction> {
  const mod = await import("@/actions/dashboard-realtime");
  return mod.getDashboardRealtimeData as unknown as AnyAction;
}

async function loadStatisticsAction(): Promise<AnyAction> {
  const mod = await import("@/actions/statistics");
  return mod.getUserStatistics as unknown as AnyAction;
}

async function loadConcurrentSessionsAction(): Promise<AnyAction> {
  const mod = await import("@/actions/concurrent-sessions");
  return mod.getConcurrentSessions as unknown as AnyAction;
}

async function loadProviderSlotsAction(): Promise<AnyAction> {
  const mod = await import("@/actions/provider-slots");
  return mod.getProviderSlots as unknown as AnyAction;
}

async function loadRateLimitStatsAction(): Promise<AnyAction> {
  const mod = await import("@/actions/rate-limit-stats");
  return mod.getRateLimitStats as unknown as AnyAction;
}

async function loadClientVersionsAction(): Promise<AnyAction> {
  const mod = await import("@/actions/client-versions");
  return mod.fetchClientVersionStats as unknown as AnyAction;
}

async function loadProxyStatusAction(): Promise<AnyAction> {
  const mod = await import("@/actions/proxy-status");
  return mod.getProxyStatus as unknown as AnyAction;
}

async function loadDispatchSimulatorActions() {
  const mod = await import("@/actions/dispatch-simulator");
  return {
    decisionTree: mod.simulateDispatchDecisionTree as unknown as AnyAction,
    simulate: mod.simulateDispatchAction as unknown as AnyAction,
  };
}

// ==================== GET /dashboard/overview ====================

export async function getOverview(c: Context): Promise<Response> {
  const action = await loadOverviewAction();
  const result = await callAction<unknown>(c, action, []);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200, { noStore: true });
}

// ==================== GET /dashboard/realtime ====================

export async function getRealtime(c: Context): Promise<Response> {
  const action = await loadRealtimeAction();
  const result = await callAction<unknown>(c, action, []);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200, { noStore: true });
}

// ==================== GET /dashboard/statistics ====================

export async function getStatistics(c: Context): Promise<Response> {
  const action = await loadStatisticsAction();
  const timeRange = c.req.query("timeRange");
  const result = await callAction<unknown>(c, action, [timeRange]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /dashboard/concurrent-sessions ====================

export async function getConcurrentSessions(c: Context): Promise<Response> {
  const action = await loadConcurrentSessionsAction();
  const result = await callAction<number>(c, action, []);
  if (!result.ok) return result.problem;
  return respondJson(c, { count: result.data ?? 0, generatedAt: new Date().toISOString() }, 200, {
    noStore: true,
  });
}

// ==================== GET /dashboard/provider-slots ====================

export async function getProviderSlots(c: Context): Promise<Response> {
  const action = await loadProviderSlotsAction();
  const result = await callAction<unknown[]>(c, action, []);
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data ?? [], generatedAt: new Date().toISOString() }, 200, {
    noStore: true,
  });
}

// ==================== GET /dashboard/rate-limit-stats ====================

export async function getRateLimitStats(c: Context): Promise<Response> {
  const action = await loadRateLimitStatsAction();
  const result = await callAction<unknown>(c, action, []);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200, { noStore: true });
}

// ==================== GET /dashboard/client-versions ====================

export async function getClientVersions(c: Context): Promise<Response> {
  const action = await loadClientVersionsAction();
  const result = await callAction<unknown[]>(c, action, []);
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data ?? [], generatedAt: new Date().toISOString() }, 200, {
    noStore: true,
  });
}

// ==================== GET /dashboard/proxy-status ====================

export async function getProxyStatus(c: Context): Promise<Response> {
  const action = await loadProxyStatusAction();
  const result = await callAction<unknown>(c, action, []);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200, { noStore: true });
}

// ==================== POST /dashboard/dispatch-simulator:decisionTree ====================

export async function simulateDecisionTree(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof DispatchSimulatorRequestSchema>(
    c,
    DispatchSimulatorRequestSchema,
    { strict: false }
  );
  if (!body.ok) return body.response;
  const actions = await loadDispatchSimulatorActions();
  const result = await callAction<unknown>(c, actions.decisionTree, [body.data]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== POST /dashboard/dispatch-simulator:simulate ====================

export async function simulateDispatch(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof DispatchSimulatorRequestSchema>(
    c,
    DispatchSimulatorRequestSchema,
    { strict: false }
  );
  if (!body.ok) return body.response;
  const actions = await loadDispatchSimulatorActions();
  const result = await callAction<unknown>(c, actions.simulate, [body.data]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}
