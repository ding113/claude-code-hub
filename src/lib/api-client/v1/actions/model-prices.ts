import type { AvailableModelCatalogItem, AvailableModelCatalogScope } from "@/actions/model-prices";
import type { PriceUpdateResult, SyncConflictCheckResult } from "@/types/model-price";
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  searchParams,
  toActionResult,
  toVoidActionResult,
  unwrapItems,
} from "./_compat";

export type { AvailableModelCatalogItem, AvailableModelCatalogScope } from "@/actions/model-prices";

export function uploadPriceTable(content: string, overwriteManual?: string[]) {
  return toActionResult(
    apiPost<PriceUpdateResult>("/api/v1/model-prices:upload", { content, overwriteManual })
  );
}

export function getModelPrices() {
  return apiGet<{ items?: unknown[] }>("/api/v1/model-prices").then(unwrapItems);
}

export function getAvailableModelCatalog(options?: { scope?: AvailableModelCatalogScope }) {
  return apiGet<{ items?: AvailableModelCatalogItem[] }>(
    `/api/v1/model-prices/catalog${searchParams({ scope: options?.scope })}`
  ).then(unwrapItems);
}

export function getModelPricesPaginated(params?: Record<string, unknown>) {
  return apiGet(`/api/v1/model-prices${searchParams(toQuery(params))}`);
}

export function hasPriceTable(): Promise<boolean> {
  return apiGet<{ exists: boolean }>("/api/v1/model-prices/exists").then((body) => body.exists);
}

export function getAvailableModelsByProviderType(): Promise<string[]> {
  return getAvailableModelCatalog({ scope: "chat" }).then((items) =>
    items.map((item) => item.modelName)
  );
}

export function checkLiteLLMSyncConflicts() {
  return toActionResult(apiPost<SyncConflictCheckResult>("/api/v1/model-prices:syncLitellmCheck"));
}

export function syncLiteLLMPrices(overwriteManual?: string[]) {
  return toActionResult(
    apiPost<PriceUpdateResult>("/api/v1/model-prices:syncLitellm", { overwriteManual })
  );
}

export function upsertSingleModelPrice(data: Record<string, unknown>) {
  const modelName = encodeURIComponent(String(data.modelName ?? data.model_name ?? ""));
  return toActionResult(apiPut(`/api/v1/model-prices/${modelName}`, data));
}

export function deleteSingleModelPrice(modelName: string) {
  return toVoidActionResult(apiDelete(`/api/v1/model-prices/${encodeURIComponent(modelName)}`));
}

export function pinModelPricingProviderAsManual(input: {
  modelName: string;
  pricingProviderKey: string;
}) {
  return toActionResult(
    apiPost(`/api/v1/model-prices/${encodeURIComponent(input.modelName)}/pricing:pinManual`, {
      pricingProviderKey: input.pricingProviderKey,
    })
  );
}

function toQuery(params?: Record<string, unknown>) {
  return {
    page: asQuery(params?.page),
    pageSize: asQuery(params?.pageSize),
    search: asQuery(params?.search),
    source: asQuery(params?.source),
    litellmProvider: asQuery(params?.litellmProvider),
  };
}

function asQuery(value: unknown): string | number | boolean | undefined {
  return ["string", "number", "boolean"].includes(typeof value)
    ? (value as string | number | boolean)
    : undefined;
}
