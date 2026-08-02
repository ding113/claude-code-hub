import type {
  ProviderSiteDto,
  ProviderSiteGroupRateDto,
  ProviderSiteListItem,
  ProviderSiteSyncResultDto,
} from "@/actions/provider-sites";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  toActionResult,
  toVoidActionResult,
} from "./_compat";

export type {
  ProviderSiteDto,
  ProviderSiteGroupRateDto,
  ProviderSiteListItem,
  ProviderSiteSyncResultDto,
};

export function getProviderSites() {
  return toActionResult(
    apiGet<{ items?: ProviderSiteListItem[] }>("/api/v1/provider-sites").then(
      (body) => body.items ?? []
    )
  );
}

export function createProviderSite(data: unknown) {
  return toActionResult(apiPost<ProviderSiteDto>("/api/v1/provider-sites", data));
}

export function updateProviderSite(id: number, data: unknown) {
  return toActionResult(apiPatch<ProviderSiteDto>(`/api/v1/provider-sites/${id}`, data));
}

export function deleteProviderSite(id: number) {
  return toVoidActionResult(apiDelete(`/api/v1/provider-sites/${id}`));
}

export function reorderProviderSites(orderedIds: number[]) {
  return toActionResult(
    apiPost<{ items?: ProviderSiteListItem[] }>("/api/v1/provider-sites:reorder", {
      orderedIds,
    }).then((body) => body.items ?? [])
  );
}

export function upsertProviderSiteGroupRate(siteId: number, data: unknown) {
  return toActionResult(
    apiPut<ProviderSiteGroupRateDto>(`/api/v1/provider-sites/${siteId}/group-rates`, data)
  );
}

export function updateProviderSiteGroupRate(rateId: number, data: unknown) {
  return toActionResult(
    apiPatch<ProviderSiteGroupRateDto>(`/api/v1/provider-sites/group-rates/${rateId}`, data)
  );
}

export function deleteProviderSiteGroupRate(rateId: number) {
  return toVoidActionResult(apiDelete(`/api/v1/provider-sites/group-rates/${rateId}`));
}

export function syncProviderSiteRates(id: number) {
  return toActionResult(
    apiPost<ProviderSiteSyncResultDto>(`/api/v1/provider-sites/${id}/sync-rates`, {})
  );
}

export function syncAllProviderSiteRates() {
  return toActionResult(
    apiPost<{ items?: ProviderSiteSyncResultDto[] }>("/api/v1/provider-sites/sync-rates", {}).then(
      (body) => body.items ?? []
    )
  );
}
