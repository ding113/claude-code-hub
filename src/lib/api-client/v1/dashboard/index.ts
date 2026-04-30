/**
 * /api/v1/dashboard 类型化客户端方法
 */

import type { z } from "@hono/zod-openapi";
import type {
  DashboardClientVersionsResponseSchema,
  DashboardConcurrentSessionsResponseSchema,
  DashboardOverviewResponseSchema,
  DashboardProviderSlotsResponseSchema,
  DashboardProxyStatusResponseSchema,
  DashboardRateLimitStatsResponseSchema,
  DashboardRealtimeResponseSchema,
  DashboardStatisticsResponseSchema,
  DispatchSimulatorRequestSchema,
  DispatchSimulatorResponseSchema,
} from "@/lib/api/v1/schemas/dashboard";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

type DashboardOverviewResponse = z.infer<typeof DashboardOverviewResponseSchema>;
type DashboardRealtimeResponse = z.infer<typeof DashboardRealtimeResponseSchema>;
type DashboardStatisticsResponse = z.infer<typeof DashboardStatisticsResponseSchema>;
type DashboardConcurrentSessionsResponse = z.infer<
  typeof DashboardConcurrentSessionsResponseSchema
>;
type DashboardProviderSlotsResponse = z.infer<typeof DashboardProviderSlotsResponseSchema>;
type DashboardRateLimitStatsResponse = z.infer<typeof DashboardRateLimitStatsResponseSchema>;
type DashboardClientVersionsResponse = z.infer<typeof DashboardClientVersionsResponseSchema>;
type DashboardProxyStatusResponse = z.infer<typeof DashboardProxyStatusResponseSchema>;
type DispatchSimulatorRequest = z.infer<typeof DispatchSimulatorRequestSchema>;
type DispatchSimulatorResponse = z.infer<typeof DispatchSimulatorResponseSchema>;

const BASE_PATH = "/api/v1/dashboard";

export interface DashboardClient {
  overview(): Promise<DashboardOverviewResponse>;
  realtime(): Promise<DashboardRealtimeResponse>;
  statistics(timeRange?: string): Promise<DashboardStatisticsResponse>;
  concurrentSessions(): Promise<DashboardConcurrentSessionsResponse>;
  providerSlots(): Promise<DashboardProviderSlotsResponse>;
  rateLimitStats(): Promise<DashboardRateLimitStatsResponse>;
  clientVersions(): Promise<DashboardClientVersionsResponse>;
  proxyStatus(): Promise<DashboardProxyStatusResponse>;
  dispatchSimulatorDecisionTree(
    input: DispatchSimulatorRequest
  ): Promise<DispatchSimulatorResponse>;
  dispatchSimulatorSimulate(input: DispatchSimulatorRequest): Promise<DispatchSimulatorResponse>;
}

async function overview(): Promise<DashboardOverviewResponse> {
  const r = await fetchApi(`${BASE_PATH}/overview`, { method: "GET" });
  return (await r.json()) as DashboardOverviewResponse;
}

async function realtime(): Promise<DashboardRealtimeResponse> {
  const r = await fetchApi(`${BASE_PATH}/realtime`, { method: "GET" });
  return (await r.json()) as DashboardRealtimeResponse;
}

async function statistics(timeRange?: string): Promise<DashboardStatisticsResponse> {
  const query = timeRange ? `?timeRange=${encodeURIComponent(timeRange)}` : "";
  const r = await fetchApi(`${BASE_PATH}/statistics${query}`, { method: "GET" });
  return (await r.json()) as DashboardStatisticsResponse;
}

async function concurrentSessions(): Promise<DashboardConcurrentSessionsResponse> {
  const r = await fetchApi(`${BASE_PATH}/concurrent-sessions`, { method: "GET" });
  return (await r.json()) as DashboardConcurrentSessionsResponse;
}

async function providerSlots(): Promise<DashboardProviderSlotsResponse> {
  const r = await fetchApi(`${BASE_PATH}/provider-slots`, { method: "GET" });
  return (await r.json()) as DashboardProviderSlotsResponse;
}

async function rateLimitStats(): Promise<DashboardRateLimitStatsResponse> {
  const r = await fetchApi(`${BASE_PATH}/rate-limit-stats`, { method: "GET" });
  return (await r.json()) as DashboardRateLimitStatsResponse;
}

async function clientVersions(): Promise<DashboardClientVersionsResponse> {
  const r = await fetchApi(`${BASE_PATH}/client-versions`, { method: "GET" });
  return (await r.json()) as DashboardClientVersionsResponse;
}

async function proxyStatus(): Promise<DashboardProxyStatusResponse> {
  const r = await fetchApi(`${BASE_PATH}/proxy-status`, { method: "GET" });
  return (await r.json()) as DashboardProxyStatusResponse;
}

async function dispatchSimulatorDecisionTree(
  input: DispatchSimulatorRequest
): Promise<DispatchSimulatorResponse> {
  const r = await fetchApi(`${BASE_PATH}/dispatch-simulator:decisionTree`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await r.json()) as DispatchSimulatorResponse;
}

async function dispatchSimulatorSimulate(
  input: DispatchSimulatorRequest
): Promise<DispatchSimulatorResponse> {
  const r = await fetchApi(`${BASE_PATH}/dispatch-simulator:simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await r.json()) as DispatchSimulatorResponse;
}

export const dashboardClient: DashboardClient = {
  overview,
  realtime,
  statistics,
  concurrentSessions,
  providerSlots,
  rateLimitStats,
  clientVersions,
  proxyStatus,
  dispatchSimulatorDecisionTree,
  dispatchSimulatorSimulate,
};

Object.assign(apiClient, { dashboard: dashboardClient });
