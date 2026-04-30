/**
 * /api/v1/model-prices 类型化客户端方法
 */

import type {
  ModelPriceCatalogResponse,
  ModelPriceListResponse,
  ModelPriceResponse,
  ModelPriceSyncInput,
  ModelPriceUpdateResult,
  ModelPriceUploadInput,
  SingleModelPriceUpsertInput,
  SyncConflictCheckResponse,
} from "@/lib/api/v1/schemas/model-prices";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

const BASE_PATH = "/api/v1/model-prices";

export interface ModelPricesClient {
  list(params?: { page?: number; limit?: number; q?: string }): Promise<ModelPriceListResponse>;
  exists(): Promise<{ exists: boolean }>;
  catalog(scope?: "chat" | "all"): Promise<ModelPriceCatalogResponse>;
  upload(input: ModelPriceUploadInput): Promise<ModelPriceUpdateResult>;
  syncLitellmCheck(): Promise<SyncConflictCheckResponse>;
  syncLitellm(input?: ModelPriceSyncInput): Promise<ModelPriceUpdateResult>;
  detail(modelName: string): Promise<ModelPriceResponse>;
  upsert(modelName: string, input: SingleModelPriceUpsertInput): Promise<ModelPriceResponse>;
  remove(modelName: string): Promise<void>;
  pinManual(modelName: string, providerType: string): Promise<ModelPriceResponse>;
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

async function list(params?: {
  page?: number;
  limit?: number;
  q?: string;
}): Promise<ModelPriceListResponse> {
  const response = await fetchApi(`${BASE_PATH}${buildQuery(params)}`, { method: "GET" });
  return (await response.json()) as ModelPriceListResponse;
}

async function exists(): Promise<{ exists: boolean }> {
  const response = await fetchApi(`${BASE_PATH}/exists`, { method: "GET" });
  return (await response.json()) as { exists: boolean };
}

async function catalog(scope?: "chat" | "all"): Promise<ModelPriceCatalogResponse> {
  const response = await fetchApi(`${BASE_PATH}/catalog${buildQuery({ scope })}`, {
    method: "GET",
  });
  return (await response.json()) as ModelPriceCatalogResponse;
}

async function upload(input: ModelPriceUploadInput): Promise<ModelPriceUpdateResult> {
  const response = await fetchApi(`${BASE_PATH}:upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as ModelPriceUpdateResult;
}

async function syncLitellmCheck(): Promise<SyncConflictCheckResponse> {
  const response = await fetchApi(`${BASE_PATH}:syncLitellmCheck`, { method: "POST" });
  return (await response.json()) as SyncConflictCheckResponse;
}

async function syncLitellm(input?: ModelPriceSyncInput): Promise<ModelPriceUpdateResult> {
  const response = await fetchApi(`${BASE_PATH}:syncLitellm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  return (await response.json()) as ModelPriceUpdateResult;
}

async function detail(modelName: string): Promise<ModelPriceResponse> {
  const response = await fetchApi(`${BASE_PATH}/${encodeURIComponent(modelName)}`, {
    method: "GET",
  });
  return (await response.json()) as ModelPriceResponse;
}

async function upsert(
  modelName: string,
  input: SingleModelPriceUpsertInput
): Promise<ModelPriceResponse> {
  const response = await fetchApi(`${BASE_PATH}/${encodeURIComponent(modelName)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as ModelPriceResponse;
}

async function remove(modelName: string): Promise<void> {
  await fetchApi(`${BASE_PATH}/${encodeURIComponent(modelName)}`, { method: "DELETE" });
}

async function pinManual(modelName: string, providerType: string): Promise<ModelPriceResponse> {
  const response = await fetchApi(
    `${BASE_PATH}/${encodeURIComponent(modelName)}/pricing/${encodeURIComponent(providerType)}:pinManual`,
    { method: "POST" }
  );
  return (await response.json()) as ModelPriceResponse;
}

export const modelPricesClient: ModelPricesClient = {
  list,
  exists,
  catalog,
  upload,
  syncLitellmCheck,
  syncLitellm,
  detail,
  upsert,
  remove,
  pinManual,
};

Object.assign(apiClient, { modelPrices: modelPricesClient });
