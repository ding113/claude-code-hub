/**
 * /api/v1/providers 类型化客户端方法
 */

import type {
  ProviderAutoSortPriorityInput,
  ProviderBatchResetCircuitsInput,
  ProviderBatchUpdateInput,
  ProviderCreateInput,
  ProviderKeyRevealResponse,
  ProviderListResponse,
  ProviderModelSuggestionsResponse,
  ProviderResponse,
  ProviderUpdateInput,
} from "@/lib/api/v1/schemas/providers";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

const BASE_PATH = "/api/v1/providers";

export interface ProvidersClient {
  list(params?: { include?: "statistics" }): Promise<ProviderListResponse>;
  detail(id: number): Promise<ProviderResponse>;
  create(input: ProviderCreateInput): Promise<ProviderResponse>;
  update(id: number, patch: ProviderUpdateInput): Promise<ProviderResponse>;
  remove(id: number): Promise<void>;
  health(): Promise<Record<string, unknown>>;
  resetCircuit(id: number): Promise<{ ok: boolean }>;
  resetUsage(id: number): Promise<{ ok: boolean }>;
  batchResetCircuits(input: ProviderBatchResetCircuitsInput): Promise<{ resetCount: number }>;
  groups(params?: { include?: "count" }): Promise<{ items: unknown[] }>;
  autoSortPriority(input: ProviderAutoSortPriorityInput): Promise<unknown>;
  batchUpdate(input: ProviderBatchUpdateInput): Promise<{ updatedCount: number }>;
  revealKey(id: number): Promise<ProviderKeyRevealResponse>;
  modelSuggestions(providerGroup?: string | null): Promise<ProviderModelSuggestionsResponse>;
}

function buildQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    search.append(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

async function list(params?: { include?: "statistics" }): Promise<ProviderListResponse> {
  const response = await fetchApi(`${BASE_PATH}${buildQuery(params)}`, { method: "GET" });
  return (await response.json()) as ProviderListResponse;
}

async function detail(id: number): Promise<ProviderResponse> {
  const response = await fetchApi(`${BASE_PATH}/${id}`, { method: "GET" });
  return (await response.json()) as ProviderResponse;
}

async function create(input: ProviderCreateInput): Promise<ProviderResponse> {
  const response = await fetchApi(BASE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as ProviderResponse;
}

async function update(id: number, patch: ProviderUpdateInput): Promise<ProviderResponse> {
  const response = await fetchApi(`${BASE_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await response.json()) as ProviderResponse;
}

async function remove(id: number): Promise<void> {
  await fetchApi(`${BASE_PATH}/${id}`, { method: "DELETE" });
}

async function health(): Promise<Record<string, unknown>> {
  const response = await fetchApi(`${BASE_PATH}/health`, { method: "GET" });
  return (await response.json()) as Record<string, unknown>;
}

async function resetCircuit(id: number): Promise<{ ok: boolean }> {
  const response = await fetchApi(`${BASE_PATH}/${id}/circuit:reset`, { method: "POST" });
  return (await response.json()) as { ok: boolean };
}

async function resetUsage(id: number): Promise<{ ok: boolean }> {
  const response = await fetchApi(`${BASE_PATH}/${id}/usage:reset`, { method: "POST" });
  return (await response.json()) as { ok: boolean };
}

async function batchResetCircuits(
  input: ProviderBatchResetCircuitsInput
): Promise<{ resetCount: number }> {
  const response = await fetchApi(`${BASE_PATH}/circuits:batchReset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as { resetCount: number };
}

async function groups(params?: { include?: "count" }): Promise<{ items: unknown[] }> {
  const response = await fetchApi(`${BASE_PATH}/groups${buildQuery(params)}`, { method: "GET" });
  return (await response.json()) as { items: unknown[] };
}

async function autoSortPriority(input: ProviderAutoSortPriorityInput): Promise<unknown> {
  const response = await fetchApi(`${BASE_PATH}:autoSortPriority`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as unknown;
}

async function batchUpdate(input: ProviderBatchUpdateInput): Promise<{ updatedCount: number }> {
  const response = await fetchApi(`${BASE_PATH}:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as { updatedCount: number };
}

async function revealKey(id: number): Promise<ProviderKeyRevealResponse> {
  const response = await fetchApi(`${BASE_PATH}/${id}/key:reveal`, { method: "GET" });
  return (await response.json()) as ProviderKeyRevealResponse;
}

async function modelSuggestions(
  providerGroup?: string | null
): Promise<ProviderModelSuggestionsResponse> {
  const qs = providerGroup ? `?providerGroup=${encodeURIComponent(providerGroup)}` : "";
  const response = await fetchApi(`${BASE_PATH}/model-suggestions${qs}`, { method: "GET" });
  return (await response.json()) as ProviderModelSuggestionsResponse;
}

export const providersClient: ProvidersClient = {
  list,
  detail,
  create,
  update,
  remove,
  health,
  resetCircuit,
  resetUsage,
  batchResetCircuits,
  groups,
  autoSortPriority,
  batchUpdate,
  revealKey,
  modelSuggestions,
};

Object.assign(apiClient, { providers: providersClient });
