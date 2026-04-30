/**
 * /api/v1/provider-vendors + /api/v1/provider-endpoints 类型化客户端方法
 */

import type {
  ProviderEndpointCreateInput,
  ProviderEndpointListResponse,
  ProviderEndpointProbeInput,
  ProviderEndpointResponse,
  ProviderEndpointUpdateInput,
  ProviderVendorListResponse,
  ProviderVendorResponse,
  ProviderVendorUpdateInput,
} from "@/lib/api/v1/schemas/provider-endpoints";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

const VENDORS_BASE_PATH = "/api/v1/provider-vendors";
const ENDPOINTS_BASE_PATH = "/api/v1/provider-endpoints";

export interface ProviderVendorsClient {
  list(params?: { dashboard?: boolean }): Promise<ProviderVendorListResponse>;
  detail(id: number): Promise<ProviderVendorResponse>;
  update(id: number, patch: ProviderVendorUpdateInput): Promise<ProviderVendorResponse>;
  remove(id: number): Promise<void>;
  listEndpoints(
    vendorId: number,
    params?: { providerType?: string }
  ): Promise<ProviderEndpointListResponse>;
  createEndpoint(
    vendorId: number,
    input: ProviderEndpointCreateInput
  ): Promise<ProviderEndpointResponse>;
}

export interface ProviderEndpointsClient {
  update(id: number, patch: ProviderEndpointUpdateInput): Promise<ProviderEndpointResponse>;
  remove(id: number): Promise<void>;
  probe(id: number, input?: ProviderEndpointProbeInput): Promise<unknown>;
  probeLogs(id: number, params?: { limit?: number; offset?: number }): Promise<unknown>;
  circuit(id: number): Promise<unknown>;
  resetCircuit(id: number): Promise<{ ok: boolean }>;
}

function buildQuery(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    search.append(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export const providerVendorsClient: ProviderVendorsClient = {
  async list(params) {
    const response = await fetchApi(`${VENDORS_BASE_PATH}${buildQuery(params)}`, {
      method: "GET",
    });
    return (await response.json()) as ProviderVendorListResponse;
  },
  async detail(id) {
    const response = await fetchApi(`${VENDORS_BASE_PATH}/${id}`, { method: "GET" });
    return (await response.json()) as ProviderVendorResponse;
  },
  async update(id, patch) {
    const response = await fetchApi(`${VENDORS_BASE_PATH}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return (await response.json()) as ProviderVendorResponse;
  },
  async remove(id) {
    await fetchApi(`${VENDORS_BASE_PATH}/${id}`, { method: "DELETE" });
  },
  async listEndpoints(vendorId, params) {
    const response = await fetchApi(
      `${VENDORS_BASE_PATH}/${vendorId}/endpoints${buildQuery(params)}`,
      { method: "GET" }
    );
    return (await response.json()) as ProviderEndpointListResponse;
  },
  async createEndpoint(vendorId, input) {
    const response = await fetchApi(`${VENDORS_BASE_PATH}/${vendorId}/endpoints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return (await response.json()) as ProviderEndpointResponse;
  },
};

export const providerEndpointsClient: ProviderEndpointsClient = {
  async update(id, patch) {
    const response = await fetchApi(`${ENDPOINTS_BASE_PATH}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return (await response.json()) as ProviderEndpointResponse;
  },
  async remove(id) {
    await fetchApi(`${ENDPOINTS_BASE_PATH}/${id}`, { method: "DELETE" });
  },
  async probe(id, input) {
    const response = await fetchApi(`${ENDPOINTS_BASE_PATH}/${id}:probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input ?? {}),
    });
    return (await response.json()) as unknown;
  },
  async probeLogs(id, params) {
    const response = await fetchApi(
      `${ENDPOINTS_BASE_PATH}/${id}/probe-logs${buildQuery(params)}`,
      { method: "GET" }
    );
    return (await response.json()) as unknown;
  },
  async circuit(id) {
    const response = await fetchApi(`${ENDPOINTS_BASE_PATH}/${id}/circuit`, { method: "GET" });
    return (await response.json()) as unknown;
  },
  async resetCircuit(id) {
    const response = await fetchApi(`${ENDPOINTS_BASE_PATH}/${id}/circuit:reset`, {
      method: "POST",
    });
    return (await response.json()) as { ok: boolean };
  },
};

Object.assign(apiClient, {
  providerVendors: providerVendorsClient,
  providerEndpoints: providerEndpointsClient,
});
