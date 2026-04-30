/**
 * /api/v1/error-rules 类型化客户端方法
 */

import type { z } from "@hono/zod-openapi";
import type {
  ErrorRuleCreateSchema,
  ErrorRuleSchema,
  ErrorRulesCacheRefreshResponseSchema,
  ErrorRulesCacheStatsResponseSchema,
  ErrorRulesListResponseSchema,
  ErrorRuleTestRequestSchema,
  ErrorRuleTestResponseSchema,
  ErrorRuleUpdateSchema,
} from "@/lib/api/v1/schemas/error-rules";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

type ErrorRule = z.infer<typeof ErrorRuleSchema>;
type ErrorRulesListResponse = z.infer<typeof ErrorRulesListResponseSchema>;
type ErrorRuleCreateInput = z.infer<typeof ErrorRuleCreateSchema>;
type ErrorRuleUpdateInput = z.infer<typeof ErrorRuleUpdateSchema>;
type ErrorRuleTestRequest = z.infer<typeof ErrorRuleTestRequestSchema>;
type ErrorRuleTestResponse = z.infer<typeof ErrorRuleTestResponseSchema>;
type ErrorRulesCacheRefreshResponse = z.infer<typeof ErrorRulesCacheRefreshResponseSchema>;
type ErrorRulesCacheStatsResponse = z.infer<typeof ErrorRulesCacheStatsResponseSchema>;

const BASE_PATH = "/api/v1/error-rules";

export interface ErrorRulesClient {
  list(): Promise<ErrorRulesListResponse>;
  create(input: ErrorRuleCreateInput): Promise<ErrorRule>;
  update(id: number, patch: ErrorRuleUpdateInput): Promise<ErrorRule>;
  remove(id: number): Promise<void>;
  refreshCache(): Promise<ErrorRulesCacheRefreshResponse>;
  test(input: ErrorRuleTestRequest): Promise<ErrorRuleTestResponse>;
  cacheStats(): Promise<ErrorRulesCacheStatsResponse>;
}

async function list(): Promise<ErrorRulesListResponse> {
  const r = await fetchApi(BASE_PATH, { method: "GET" });
  return (await r.json()) as ErrorRulesListResponse;
}

async function create(input: ErrorRuleCreateInput): Promise<ErrorRule> {
  const r = await fetchApi(BASE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await r.json()) as ErrorRule;
}

async function update(id: number, patch: ErrorRuleUpdateInput): Promise<ErrorRule> {
  const r = await fetchApi(`${BASE_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await r.json()) as ErrorRule;
}

async function remove(id: number): Promise<void> {
  await fetchApi(`${BASE_PATH}/${id}`, { method: "DELETE" });
}

async function refreshCache(): Promise<ErrorRulesCacheRefreshResponse> {
  const r = await fetchApi(`${BASE_PATH}/cache:refresh`, { method: "POST" });
  return (await r.json()) as ErrorRulesCacheRefreshResponse;
}

async function test(input: ErrorRuleTestRequest): Promise<ErrorRuleTestResponse> {
  const r = await fetchApi(`${BASE_PATH}:test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await r.json()) as ErrorRuleTestResponse;
}

async function cacheStats(): Promise<ErrorRulesCacheStatsResponse> {
  const r = await fetchApi(`${BASE_PATH}/cache/stats`, { method: "GET" });
  return (await r.json()) as ErrorRulesCacheStatsResponse;
}

export const errorRulesClient: ErrorRulesClient = {
  list,
  create,
  update,
  remove,
  refreshCache,
  test,
  cacheStats,
};

Object.assign(apiClient, { errorRules: errorRulesClient });
