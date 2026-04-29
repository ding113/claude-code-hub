/**
 * /api/v1/sensitive-words 类型化客户端方法
 */

import type { z } from "@hono/zod-openapi";
import type {
  SensitiveWordCreateSchema,
  SensitiveWordSchema,
  SensitiveWordsCacheRefreshResponseSchema,
  SensitiveWordsCacheStatsResponseSchema,
  SensitiveWordsListResponseSchema,
  SensitiveWordUpdateSchema,
} from "@/lib/api/v1/schemas/sensitive-words";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

type SensitiveWord = z.infer<typeof SensitiveWordSchema>;
type SensitiveWordsListResponse = z.infer<typeof SensitiveWordsListResponseSchema>;
type SensitiveWordCreateInput = z.infer<typeof SensitiveWordCreateSchema>;
type SensitiveWordUpdateInput = z.infer<typeof SensitiveWordUpdateSchema>;
type SensitiveWordsCacheRefreshResponse = z.infer<typeof SensitiveWordsCacheRefreshResponseSchema>;
type SensitiveWordsCacheStatsResponse = z.infer<typeof SensitiveWordsCacheStatsResponseSchema>;

const BASE_PATH = "/api/v1/sensitive-words";

export interface SensitiveWordsClient {
  list(): Promise<SensitiveWordsListResponse>;
  create(input: SensitiveWordCreateInput): Promise<SensitiveWord>;
  update(id: number, patch: SensitiveWordUpdateInput): Promise<SensitiveWord>;
  remove(id: number): Promise<void>;
  refreshCache(): Promise<SensitiveWordsCacheRefreshResponse>;
  cacheStats(): Promise<SensitiveWordsCacheStatsResponse>;
}

async function list(): Promise<SensitiveWordsListResponse> {
  const r = await fetchApi(BASE_PATH, { method: "GET" });
  return (await r.json()) as SensitiveWordsListResponse;
}

async function create(input: SensitiveWordCreateInput): Promise<SensitiveWord> {
  const r = await fetchApi(BASE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await r.json()) as SensitiveWord;
}

async function update(id: number, patch: SensitiveWordUpdateInput): Promise<SensitiveWord> {
  const r = await fetchApi(`${BASE_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await r.json()) as SensitiveWord;
}

async function remove(id: number): Promise<void> {
  await fetchApi(`${BASE_PATH}/${id}`, { method: "DELETE" });
}

async function refreshCache(): Promise<SensitiveWordsCacheRefreshResponse> {
  const r = await fetchApi(`${BASE_PATH}/cache:refresh`, { method: "POST" });
  return (await r.json()) as SensitiveWordsCacheRefreshResponse;
}

async function cacheStats(): Promise<SensitiveWordsCacheStatsResponse> {
  const r = await fetchApi(`${BASE_PATH}/cache/stats`, { method: "GET" });
  return (await r.json()) as SensitiveWordsCacheStatsResponse;
}

export const sensitiveWordsClient: SensitiveWordsClient = {
  list,
  create,
  update,
  remove,
  refreshCache,
  cacheStats,
};

Object.assign(apiClient, { sensitiveWords: sensitiveWordsClient });
