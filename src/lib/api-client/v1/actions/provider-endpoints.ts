import type { DashboardProviderVendor } from "@/actions/provider-endpoints";
import { DASHBOARD_COMPAT_HEADER } from "@/lib/api/v1/_shared/constants";
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
  return apiGet<{ items?: ProviderEndpoint[] }>(
    `/api/v1/provider-vendors/${input.vendorId}/endpoints${searchParams({
      providerType: input.providerType,
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
  return toActionResult(
    apiPost<VendorTypeEndpointStats[]>(
      "/api/v1/provider-vendors/endpoint-stats:batch",
      input,
      dashboardCompatOptions
    )
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
