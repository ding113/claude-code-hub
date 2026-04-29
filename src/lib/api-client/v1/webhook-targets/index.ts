/**
 * /api/v1/webhook-targets 类型化客户端方法
 *
 * 设计要点：
 * - 所有方法都通过 `fetchApi` 调用，自动处理 CSRF + problem+json；
 * - 输入直接透传 JSON；不在客户端做额外脱敏（写请求允许包含敏感字段）；
 * - 输出从响应 JSON 解析为 `WebhookTargetResponse`（敏感字段已被服务端脱敏）；
 * - 通过 `Object.assign(apiClient, { webhookTargets: ... })` 把方法挂载到全局
 *   命名空间，便于在 hook 中以 `apiClient.webhookTargets.list()` 调用。
 */

import type {
  WebhookTargetCreateInput,
  WebhookTargetListResponse,
  WebhookTargetResponse,
  WebhookTargetTestInput,
  WebhookTargetTestResponse,
  WebhookTargetUpdateInput,
} from "@/lib/api/v1/schemas/webhook-targets";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

const BASE_PATH = "/api/v1/webhook-targets";

export interface WebhookTargetsClient {
  list(): Promise<WebhookTargetListResponse>;
  detail(id: number): Promise<WebhookTargetResponse>;
  create(input: WebhookTargetCreateInput): Promise<WebhookTargetResponse>;
  update(id: number, patch: WebhookTargetUpdateInput): Promise<WebhookTargetResponse>;
  remove(id: number): Promise<void>;
  test(id: number, body: WebhookTargetTestInput): Promise<WebhookTargetTestResponse>;
}

async function list(): Promise<WebhookTargetListResponse> {
  const response = await fetchApi(BASE_PATH, { method: "GET" });
  return (await response.json()) as WebhookTargetListResponse;
}

async function detail(id: number): Promise<WebhookTargetResponse> {
  const response = await fetchApi(`${BASE_PATH}/${id}`, { method: "GET" });
  return (await response.json()) as WebhookTargetResponse;
}

async function create(input: WebhookTargetCreateInput): Promise<WebhookTargetResponse> {
  const response = await fetchApi(BASE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as WebhookTargetResponse;
}

async function update(id: number, patch: WebhookTargetUpdateInput): Promise<WebhookTargetResponse> {
  const response = await fetchApi(`${BASE_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await response.json()) as WebhookTargetResponse;
}

async function remove(id: number): Promise<void> {
  await fetchApi(`${BASE_PATH}/${id}`, { method: "DELETE" });
}

async function test(id: number, body: WebhookTargetTestInput): Promise<WebhookTargetTestResponse> {
  const response = await fetchApi(`${BASE_PATH}/${id}:test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as WebhookTargetTestResponse;
}

export const webhookTargetsClient: WebhookTargetsClient = {
  list,
  detail,
  create,
  update,
  remove,
  test,
};

// 把方法挂载到全局 apiClient 命名空间，便于 hook 中以 apiClient.webhookTargets.* 调用
Object.assign(apiClient, { webhookTargets: webhookTargetsClient });
