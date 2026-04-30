import type { DashboardProviderVendor } from "@/actions/provider-endpoints";
import { DASHBOARD_COMPAT_HEADER, HIDDEN_PROVIDER_TYPES } from "@/lib/api/v1/_shared/constants";
import type { ProviderEndpoint, ProviderVendor } from "@/types/provider";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  searchParams,
  toActionResult,
  toVoidActionResult,
  unwrapItems,
} from "./_compat";

export type { DashboardProviderVendor } from "@/actions/provider-endpoints";

const dashboardCompatOptions = {
  headers: {
    [DASHBOARD_COMPAT_HEADER]: "1",
  },
} as const;

const hiddenProviderTypes = new Set<string>(HIDDEN_PROVIDER_TYPES);

type VendorTypeEndpointStats = {
  vendorId: number;
  total: number;
  enabled: number;
  healthy: number;
  unhealthy: number;
  unknown: number;
};

export function getProviderVendors() {
  return apiGet<{ items?: ProviderVendor[] }>(
    "/api/v1/provider-vendors",
    dashboardCompatOptions
  ).then(unwrapItems);
}

export function getDashboardProviderVendors() {
  return apiGet<{ items?: DashboardProviderVendor[] }>(
    "/api/v1/provider-vendors?dashboard=true",
    dashboardCompatOptions
  ).then(unwrapItems);
}

export function getProviderVendorById(vendorId: number) {
  return apiGet<ProviderVendor | null>(
    `/api/v1/provider-vendors/${vendorId}`,
    dashboardCompatOptions
  );
}

export function editProviderVendor(input: { vendorId: number } & Record<string, unknown>) {
  const { vendorId, ...body } = input;
  return toActionResult(
    apiPatch(`/api/v1/provider-vendors/${vendorId}`, body, dashboardCompatOptions)
  );
}

export function removeProviderVendor(input: { vendorId: number }) {
  return toVoidActionResult(
    apiDelete(`/api/v1/provider-vendors/${input.vendorId}`, dashboardCompatOptions)
  );
}

export function getProviderEndpoints(input: {
  vendorId: number;
  providerType?: string;
  dashboard?: boolean;
}) {
  const providerTypeQuery = hiddenProviderTypes.has(input.providerType ?? "")
    ? undefined
    : input.providerType;
  return apiGet<{ items?: ProviderEndpoint[] }>(
    `/api/v1/provider-vendors/${input.vendorId}/endpoints${searchParams({
      providerType: providerTypeQuery,
      dashboard: input.dashboard,
    })}`,
    dashboardCompatOptions
  )
    .then(unwrapItems)
    .then((items) =>
      input.providerType ? items.filter((item) => item.providerType === input.providerType) : items
    );
}

export function getDashboardProviderEndpoints(input: { vendorId: number; providerType?: string }) {
  return getProviderEndpoints({ ...input, dashboard: true });
}

export function getProviderEndpointsByVendor(input: { vendorId: number }) {
  return getProviderEndpoints(input);
}

export function addProviderEndpoint(input: { vendorId: number } & Record<string, unknown>) {
  const { vendorId, ...body } = input;
  return toActionResult(
    apiPost(`/api/v1/provider-vendors/${vendorId}/endpoints`, body, dashboardCompatOptions)
  );
}

export function editProviderEndpoint(input: { endpointId: number } & Record<string, unknown>) {
  const { endpointId, ...body } = input;
  return toActionResult(
    apiPatch(`/api/v1/provider-endpoints/${endpointId}`, body, dashboardCompatOptions)
  );
}

export function removeProviderEndpoint(input: { endpointId: number }) {
  return toVoidActionResult(
    apiDelete(`/api/v1/provider-endpoints/${input.endpointId}`, dashboardCompatOptions)
  );
}

export function probeProviderEndpoint(input: { endpointId: number } & Record<string, unknown>) {
  const { endpointId, ...body } = input;
  return toActionResult(
    apiPost(`/api/v1/provider-endpoints/${endpointId}:probe`, body, dashboardCompatOptions)
  );
}

export function getProviderEndpointProbeLogs(input: {
  endpointId: number;
  limit?: number;
  offset?: number;
}) {
  return toActionResult(
    apiGet(
      `/api/v1/provider-endpoints/${input.endpointId}/probe-logs${searchParams({
        limit: input.limit,
        offset: input.offset,
      })}`,
      dashboardCompatOptions
    )
  );
}

export function batchGetProviderEndpointProbeLogs(input: unknown) {
  return toActionResult(
    apiPost("/api/v1/provider-endpoints/probe-logs:batch", input, dashboardCompatOptions)
  );
}

export function batchGetVendorTypeEndpointStats(input: unknown) {
  const hiddenInput = parseHiddenVendorEndpointStatsInput(input);
  if (hiddenInput) {
    return toActionResult(loadHiddenVendorEndpointStats(hiddenInput));
  }

  return toActionResult(
    apiPost<VendorTypeEndpointStats[]>(
      "/api/v1/provider-vendors/endpoint-stats:batch",
      input,
      dashboardCompatOptions
    )
  );
}

function parseHiddenVendorEndpointStatsInput(
  input: unknown
): { vendorIds: number[]; providerType: string } | null {
  if (!input || typeof input !== "object") return null;
  const value = input as { vendorIds?: unknown; providerType?: unknown };
  if (typeof value.providerType !== "string" || !hiddenProviderTypes.has(value.providerType)) {
    return null;
  }
  if (!Array.isArray(value.vendorIds)) return null;

  const vendorIds = value.vendorIds.filter(
    (vendorId): vendorId is number => Number.isInteger(vendorId) && vendorId > 0
  );
  return { vendorIds: Array.from(new Set(vendorIds)), providerType: value.providerType };
}

async function loadHiddenVendorEndpointStats(input: {
  vendorIds: number[];
  providerType: string;
}): Promise<VendorTypeEndpointStats[]> {
  return Promise.all(
    input.vendorIds.map(async (vendorId) => {
      const endpoints = await getProviderEndpoints({
        vendorId,
        providerType: input.providerType,
        dashboard: true,
      });
      const activeEndpoints = endpoints.filter((endpoint) => endpoint.deletedAt === null);
      const enabledEndpoints = activeEndpoints.filter((endpoint) => endpoint.isEnabled === true);
      return {
        vendorId,
        total: activeEndpoints.length,
        enabled: enabledEndpoints.length,
        healthy: enabledEndpoints.filter((endpoint) => endpoint.lastProbeOk === true).length,
        unhealthy: enabledEndpoints.filter((endpoint) => endpoint.lastProbeOk === false).length,
        unknown: enabledEndpoints.filter((endpoint) => endpoint.lastProbeOk == null).length,
      };
    })
  );
}

export function getEndpointCircuitInfo(input: { endpointId: number }) {
  return toActionResult(
    apiGet(`/api/v1/provider-endpoints/${input.endpointId}/circuit`, dashboardCompatOptions)
  );
}

export function batchGetEndpointCircuitInfo(input: unknown) {
  return toActionResult(
    apiPost("/api/v1/provider-endpoints/circuits:batch", input, dashboardCompatOptions)
  );
}

export function resetEndpointCircuit(input: { endpointId: number }) {
  return toVoidActionResult(
    apiPost(
      `/api/v1/provider-endpoints/${input.endpointId}/circuit:reset`,
      undefined,
      dashboardCompatOptions
    )
  );
}

export function getVendorTypeCircuitInfo(input: { vendorId: number; providerType: string }) {
  return toActionResult(
    apiGet(
      `/api/v1/provider-vendors/${input.vendorId}/circuit${searchParams({
        providerType: input.providerType,
      })}`,
      dashboardCompatOptions
    )
  );
}

export function setVendorTypeCircuitManualOpen(input: {
  vendorId: number;
  providerType: string;
  manualOpen: boolean;
}) {
  return toVoidActionResult(
    apiPost(
      `/api/v1/provider-vendors/${input.vendorId}/circuit:setManualOpen`,
      {
        providerType: input.providerType,
        manualOpen: input.manualOpen,
      },
      dashboardCompatOptions
    )
  );
}

export function resetVendorTypeCircuit(input: { vendorId: number; providerType: string }) {
  return toVoidActionResult(
    apiPost(
      `/api/v1/provider-vendors/${input.vendorId}/circuit:reset`,
      {
        providerType: input.providerType,
      },
      dashboardCompatOptions
    )
  );
}
