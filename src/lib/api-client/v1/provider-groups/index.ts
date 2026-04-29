/**
 * /api/v1/provider-groups 类型化客户端方法
 */

import type {
  ProviderGroupCreateInput,
  ProviderGroupListResponse,
  ProviderGroupResponse,
  ProviderGroupUpdateInput,
} from "@/lib/api/v1/schemas/provider-groups";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

const BASE_PATH = "/api/v1/provider-groups";

export interface ProviderGroupsClient {
  list(): Promise<ProviderGroupListResponse>;
  create(input: ProviderGroupCreateInput): Promise<ProviderGroupResponse>;
  update(id: number, patch: ProviderGroupUpdateInput): Promise<ProviderGroupResponse>;
  remove(id: number): Promise<void>;
}

async function list(): Promise<ProviderGroupListResponse> {
  const response = await fetchApi(BASE_PATH, { method: "GET" });
  return (await response.json()) as ProviderGroupListResponse;
}

async function create(input: ProviderGroupCreateInput): Promise<ProviderGroupResponse> {
  const response = await fetchApi(BASE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as ProviderGroupResponse;
}

async function update(id: number, patch: ProviderGroupUpdateInput): Promise<ProviderGroupResponse> {
  const response = await fetchApi(`${BASE_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await response.json()) as ProviderGroupResponse;
}

async function remove(id: number): Promise<void> {
  await fetchApi(`${BASE_PATH}/${id}`, { method: "DELETE" });
}

export const providerGroupsClient: ProviderGroupsClient = {
  list,
  create,
  update,
  remove,
};

Object.assign(apiClient, { providerGroups: providerGroupsClient });
