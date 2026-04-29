import type { EditProviderResult, RemoveProviderResult } from "@/actions/providers";
import type { ProviderDisplay, ProviderStatisticsMap } from "@/types/provider";
import {
  apiDeleteWithHeaders,
  apiGet,
  apiPatchWithHeaders,
  apiPost,
  searchParams,
  toActionResult,
  unwrapItems,
} from "./_compat";

export type { AvailableModelCatalogItem, AvailableModelCatalogScope } from "@/actions/model-prices";
export type {
  EditProviderResult,
  PreviewProviderBatchPatchResult,
  ProviderApiTestSuccessDetails,
  ProviderBatchPreviewRow,
  RemoveProviderResult,
} from "@/actions/providers";
export type { ProviderDisplay, ProviderStatisticsMap } from "@/types/provider";

export function getProviders(): Promise<ProviderDisplay[]> {
  return apiGet<{ items?: ProviderDisplay[] }>("/api/v1/providers").then(unwrapItems);
}

export function getProviderStatisticsAsync(): Promise<ProviderStatisticsMap> {
  return apiGet("/api/v1/providers?include=statistics").then((body) => {
    const items = unwrapItems(
      body as { items?: Array<{ id: number; statistics?: ProviderStatisticsMap[number] }> }
    );
    return Object.fromEntries(
      items.flatMap((item) => (item.statistics ? [[item.id, item.statistics]] : []))
    ) as ProviderStatisticsMap;
  });
}

export function getAvailableProviderGroups(userId?: number): Promise<string[]> {
  return apiGet<{ items?: string[] }>(`/api/v1/providers/groups${searchParams({ userId })}`).then(
    unwrapItems
  );
}

export function getProviderGroupsWithCount() {
  return apiGet(`/api/v1/providers/groups?include=count`);
}

export function addProvider(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers", data));
}

export function editProvider(providerId: number, data: unknown) {
  return toActionResult(
    apiPatchWithHeaders(`/api/v1/providers/${providerId}`, data).then(({ headers }) => {
      const undoToken = headers.get("X-CCH-Undo-Token") ?? undefined;
      const operationId = headers.get("X-CCH-Operation-Id") ?? undefined;
      return { undoToken, operationId } as EditProviderResult;
    })
  );
}

export function removeProvider(providerId: number, options?: unknown) {
  return toActionResult(
    apiDeleteWithHeaders(`/api/v1/providers/${providerId}`).then(({ headers }) => {
      const undoToken = headers.get("X-CCH-Undo-Token") ?? undefined;
      const operationId = headers.get("X-CCH-Operation-Id") ?? undefined;
      return (options ?? { undoToken, operationId }) as RemoveProviderResult;
    })
  );
}

export function autoSortProviderPriority(args: unknown) {
  return toActionResult(apiPost("/api/v1/providers:autoSortPriority", args));
}

export function getProvidersHealthStatus() {
  return toActionResult(apiGet("/api/v1/providers/health"));
}

export function resetProviderCircuit(providerId: number) {
  return toActionResult(apiPost(`/api/v1/providers/${providerId}/circuit:reset`));
}

export function resetProviderTotalUsage(providerId: number) {
  return toActionResult(apiPost(`/api/v1/providers/${providerId}/usage:reset`));
}

export function previewProviderBatchPatch(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers:batchPatch:preview", data));
}

export function applyProviderBatchPatch(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers:batchPatch:apply", data));
}

export function undoProviderPatch(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers:undoPatch", data));
}

export function batchUpdateProviders(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers:batchUpdate", data));
}

export function batchDeleteProviders(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers:batchDelete", data));
}

export function undoProviderDelete(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers:undoDelete", data));
}

export function batchResetProviderCircuits(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers/circuits:batchReset", data));
}

export function getProviderLimitUsage(providerId: number) {
  return toActionResult(apiGet(`/api/v1/providers/${providerId}/limit-usage`));
}

export function getProviderLimitUsageBatch(providerIds: number[] | { providerIds: number[] }) {
  const body = Array.isArray(providerIds) ? { providerIds } : providerIds;
  return toActionResult(apiPost("/api/v1/providers/limit-usage:batch", body));
}

export function testProviderProxy(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers/test:proxy", data));
}

export function getUnmaskedProviderKey(providerId: number) {
  return toActionResult(apiGet<{ key: string }>(`/api/v1/providers/${providerId}/key:reveal`));
}

export function testProviderAnthropicMessages(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers/test:anthropic-messages", data));
}

export function testProviderOpenAIChatCompletions(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers/test:openai-chat-completions", data));
}

export function testProviderOpenAIResponses(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers/test:openai-responses", data));
}

export function testProviderGemini(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers/test:gemini", data));
}

export function testProviderUnified(data: unknown) {
  return apiPost("/api/v1/providers/test:unified", data);
}

export function getProviderTestPresets(providerType: string) {
  return toActionResult(apiGet(`/api/v1/providers/test:presets${searchParams({ providerType })}`));
}

export function fetchUpstreamModels(data: unknown) {
  return toActionResult(
    apiPost<{ models: string[] }>("/api/v1/providers/upstream-models:fetch", data)
  );
}

export function getModelSuggestionsByProviderGroup(providerGroup?: string | null) {
  return apiGet(`/api/v1/providers/model-suggestions${searchParams({ providerGroup })}`);
}

export function reclusterProviderVendors(args: unknown) {
  return toActionResult(apiPost("/api/v1/providers/vendors:recluster", args));
}

export { getAvailableModelCatalog } from "./model-prices";
