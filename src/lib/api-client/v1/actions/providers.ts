import type { EditProviderResult, RemoveProviderResult } from "@/actions/providers";
import { DASHBOARD_COMPAT_HEADER } from "@/lib/api/v1/_shared/constants";
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

const dashboardCompatOptions = {
  headers: {
    [DASHBOARD_COMPAT_HEADER]: "1",
  },
} as const;

export function getProviders(): Promise<ProviderDisplay[]> {
  return apiGet<{ items?: ProviderDisplay[] }>("/api/v1/providers", dashboardCompatOptions).then(
    unwrapItems
  );
}

export function getProviderStatisticsAsync(): Promise<ProviderStatisticsMap> {
  return apiGet("/api/v1/providers?include=statistics", dashboardCompatOptions).then((body) => {
    const items = unwrapItems(
      body as { items?: Array<{ id: number; statistics?: ProviderStatisticsMap[number] }> }
    );
    return Object.fromEntries(
      items.flatMap((item) => (item.statistics ? [[item.id, item.statistics]] : []))
    ) as ProviderStatisticsMap;
  });
}

export function getAvailableProviderGroups(userId?: number): Promise<string[]> {
  return apiGet<{ items?: string[] }>(
    `/api/v1/providers/groups${searchParams({ userId })}`,
    dashboardCompatOptions
  ).then(unwrapItems);
}

export function getProviderGroupsWithCount() {
  return apiGet(`/api/v1/providers/groups?include=count`, dashboardCompatOptions);
}

export function addProvider(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers", data));
}

export function editProvider(providerId: number, data: unknown) {
  return toActionResult(
    apiPatchWithHeaders(`/api/v1/providers/${providerId}`, data, dashboardCompatOptions).then(
      ({ headers }) => {
        const undoToken = headers.get("X-CCH-Undo-Token") ?? undefined;
        const operationId = headers.get("X-CCH-Operation-Id") ?? undefined;
        return { undoToken, operationId } as EditProviderResult;
      }
    )
  );
}

export function removeProvider(providerId: number, options?: unknown) {
  return toActionResult(
    apiDeleteWithHeaders(`/api/v1/providers/${providerId}`, dashboardCompatOptions).then(
      ({ headers }) => {
        const undoToken = headers.get("X-CCH-Undo-Token") ?? undefined;
        const operationId = headers.get("X-CCH-Operation-Id") ?? undefined;
        return (options ?? { undoToken, operationId }) as RemoveProviderResult;
      }
    )
  );
}

export function autoSortProviderPriority(args: unknown) {
  return toActionResult(
    apiPost("/api/v1/providers:autoSortPriority", args, dashboardCompatOptions)
  );
}

export function getProvidersHealthStatus() {
  return toActionResult(apiGet("/api/v1/providers/health", dashboardCompatOptions));
}

export function resetProviderCircuit(providerId: number) {
  return toActionResult(
    apiPost(`/api/v1/providers/${providerId}/circuit:reset`, undefined, dashboardCompatOptions)
  );
}

export function resetProviderTotalUsage(providerId: number) {
  return toActionResult(
    apiPost(`/api/v1/providers/${providerId}/usage:reset`, undefined, dashboardCompatOptions)
  );
}

export function previewProviderBatchPatch(data: unknown) {
  return toActionResult(
    apiPost("/api/v1/providers:batchPatch:preview", data, dashboardCompatOptions)
  );
}

export function applyProviderBatchPatch(data: unknown) {
  return toActionResult(
    apiPost("/api/v1/providers:batchPatch:apply", data, dashboardCompatOptions)
  );
}

export function undoProviderPatch(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers:undoPatch", data, dashboardCompatOptions));
}

export function batchUpdateProviders(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers:batchUpdate", data, dashboardCompatOptions));
}

export function batchDeleteProviders(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers:batchDelete", data, dashboardCompatOptions));
}

export function undoProviderDelete(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers:undoDelete", data, dashboardCompatOptions));
}

export function batchResetProviderCircuits(data: unknown) {
  return toActionResult(
    apiPost("/api/v1/providers/circuits:batchReset", data, dashboardCompatOptions)
  );
}

export function getProviderLimitUsage(providerId: number) {
  return toActionResult(
    apiGet(`/api/v1/providers/${providerId}/limit-usage`, dashboardCompatOptions)
  );
}

export function getProviderLimitUsageBatch(providerIds: number[] | { providerIds: number[] }) {
  const body = Array.isArray(providerIds) ? { providerIds } : providerIds;
  return toActionResult(
    apiPost("/api/v1/providers/limit-usage:batch", body, dashboardCompatOptions)
  );
}

export function testProviderProxy(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers/test:proxy", data, dashboardCompatOptions));
}

export function getUnmaskedProviderKey(providerId: number) {
  return toActionResult(
    apiGet<{ key: string }>(`/api/v1/providers/${providerId}/key:reveal`, dashboardCompatOptions)
  );
}

export function testProviderAnthropicMessages(data: unknown) {
  return toActionResult(
    apiPost("/api/v1/providers/test:anthropic-messages", data, dashboardCompatOptions)
  );
}

export function testProviderOpenAIChatCompletions(data: unknown) {
  return toActionResult(
    apiPost("/api/v1/providers/test:openai-chat-completions", data, dashboardCompatOptions)
  );
}

export function testProviderOpenAIResponses(data: unknown) {
  return toActionResult(
    apiPost("/api/v1/providers/test:openai-responses", data, dashboardCompatOptions)
  );
}

export function testProviderGemini(data: unknown) {
  return toActionResult(apiPost("/api/v1/providers/test:gemini", data, dashboardCompatOptions));
}

export function testProviderUnified(data: unknown) {
  return apiPost("/api/v1/providers/test:unified", data, dashboardCompatOptions);
}

export function getProviderTestPresets(providerType: string) {
  return toActionResult(
    apiGet(
      `/api/v1/providers/test:presets${searchParams({ providerType })}`,
      dashboardCompatOptions
    )
  );
}

export function fetchUpstreamModels(data: unknown) {
  return toActionResult(
    apiPost<{ models: string[] }>(
      "/api/v1/providers/upstream-models:fetch",
      data,
      dashboardCompatOptions
    )
  );
}

export function getModelSuggestionsByProviderGroup(providerGroup?: string | null) {
  return apiGet(
    `/api/v1/providers/model-suggestions${searchParams({ providerGroup })}`,
    dashboardCompatOptions
  );
}

export function reclusterProviderVendors(args: unknown) {
  return toActionResult(
    apiPost("/api/v1/providers/vendors:recluster", args, dashboardCompatOptions)
  );
}

export { getAvailableModelCatalog } from "./model-prices";
