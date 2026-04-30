/**
 * /api/v1/request-filters 类型化客户端方法
 */

import type { z } from "@hono/zod-openapi";
import type {
  RequestFilterCreateSchema,
  RequestFilterSchema,
  RequestFiltersCacheRefreshResponseSchema,
  RequestFiltersGroupOptionsResponseSchema,
  RequestFiltersListResponseSchema,
  RequestFiltersProviderOptionsResponseSchema,
  RequestFilterUpdateSchema,
} from "@/lib/api/v1/schemas/request-filters";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

type RequestFilter = z.infer<typeof RequestFilterSchema>;
type RequestFiltersListResponse = z.infer<typeof RequestFiltersListResponseSchema>;
type RequestFilterCreateInput = z.infer<typeof RequestFilterCreateSchema>;
type RequestFilterUpdateInput = z.infer<typeof RequestFilterUpdateSchema>;
type RequestFiltersCacheRefreshResponse = z.infer<typeof RequestFiltersCacheRefreshResponseSchema>;
type RequestFiltersProviderOptionsResponse = z.infer<
  typeof RequestFiltersProviderOptionsResponseSchema
>;
type RequestFiltersGroupOptionsResponse = z.infer<typeof RequestFiltersGroupOptionsResponseSchema>;

const BASE_PATH = "/api/v1/request-filters";

export interface RequestFiltersClient {
  list(): Promise<RequestFiltersListResponse>;
  create(input: RequestFilterCreateInput): Promise<RequestFilter>;
  update(id: number, patch: RequestFilterUpdateInput): Promise<RequestFilter>;
  remove(id: number): Promise<void>;
  refreshCache(): Promise<RequestFiltersCacheRefreshResponse>;
  providerOptions(): Promise<RequestFiltersProviderOptionsResponse>;
  groupOptions(): Promise<RequestFiltersGroupOptionsResponse>;
}

async function list(): Promise<RequestFiltersListResponse> {
  const r = await fetchApi(BASE_PATH, { method: "GET" });
  return (await r.json()) as RequestFiltersListResponse;
}

async function create(input: RequestFilterCreateInput): Promise<RequestFilter> {
  const r = await fetchApi(BASE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await r.json()) as RequestFilter;
}

async function update(id: number, patch: RequestFilterUpdateInput): Promise<RequestFilter> {
  const r = await fetchApi(`${BASE_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await r.json()) as RequestFilter;
}

async function remove(id: number): Promise<void> {
  await fetchApi(`${BASE_PATH}/${id}`, { method: "DELETE" });
}

async function refreshCache(): Promise<RequestFiltersCacheRefreshResponse> {
  const r = await fetchApi(`${BASE_PATH}/cache:refresh`, { method: "POST" });
  return (await r.json()) as RequestFiltersCacheRefreshResponse;
}

async function providerOptions(): Promise<RequestFiltersProviderOptionsResponse> {
  const r = await fetchApi(`${BASE_PATH}/options/providers`, { method: "GET" });
  return (await r.json()) as RequestFiltersProviderOptionsResponse;
}

async function groupOptions(): Promise<RequestFiltersGroupOptionsResponse> {
  const r = await fetchApi(`${BASE_PATH}/options/groups`, { method: "GET" });
  return (await r.json()) as RequestFiltersGroupOptionsResponse;
}

export const requestFiltersClient: RequestFiltersClient = {
  list,
  create,
  update,
  remove,
  refreshCache,
  providerOptions,
  groupOptions,
};

Object.assign(apiClient, { requestFilters: requestFiltersClient });
