/**
 * /api/v1/provider-vendors + /api/v1/provider-endpoints query keys
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const providerVendorsKeys = {
  all: [...v1Keys.all, "provider-vendors"] as const,
  list: (params?: Record<string, unknown>) =>
    [...providerVendorsKeys.all, "list", params ?? {}] as const,
  detail: (id: number) => [...providerVendorsKeys.all, "detail", id] as const,
  endpoints: (vendorId: number, params?: Record<string, unknown>) =>
    [...providerVendorsKeys.all, "endpoints", vendorId, params ?? {}] as const,
};

export const providerEndpointsKeys = {
  all: [...v1Keys.all, "provider-endpoints"] as const,
  detail: (id: number) => [...providerEndpointsKeys.all, "detail", id] as const,
  probeLogs: (id: number, params?: Record<string, unknown>) =>
    [...providerEndpointsKeys.all, "probe-logs", id, params ?? {}] as const,
  circuit: (id: number) => [...providerEndpointsKeys.all, "circuit", id] as const,
};
