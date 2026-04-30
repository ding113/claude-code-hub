"use client";

/**
 * /api/v1/webhook-targets TanStack Query hooks
 *
 * 设计要点：
 * - list / detail 使用 useQuery，依赖 webhookTargetsKeys 派生 queryKey；
 * - 写操作（create / update / delete / test）使用 useApiMutation，统一在
 *   onSuccess 中按 `webhookTargetsKeys.all` 前缀失效缓存；
 * - test 操作不修改资源列表本身，但会刷新 lastTest* 字段；为简化心智模型，
 *   仍然失效列表缓存（成本低、收益高）；
 * - 严禁导入 server actions：本文件是 client 模块的核心边界。
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  WebhookTargetCreateInput,
  WebhookTargetListResponse,
  WebhookTargetResponse,
  WebhookTargetTestInput,
  WebhookTargetTestResponse,
  WebhookTargetUpdateInput,
} from "@/lib/api/v1/schemas/webhook-targets";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { webhookTargetsClient } from "./index";
import { webhookTargetsKeys } from "./keys";

// ==================== 查询 ====================

/** 列出所有 webhook 推送目标 */
export function useWebhookTargetsList(): UseQueryResult<
  WebhookTargetListResponse,
  ApiError | Error
> {
  return useQuery<WebhookTargetListResponse, ApiError | Error>({
    queryKey: webhookTargetsKeys.list(),
    queryFn: () => webhookTargetsClient.list(),
  });
}

/** 查询单个 webhook 推送目标；只有 id > 0 时才发起请求 */
export function useWebhookTargetDetail(
  id: number
): UseQueryResult<WebhookTargetResponse, ApiError | Error> {
  return useQuery<WebhookTargetResponse, ApiError | Error>({
    queryKey: webhookTargetsKeys.detail(id),
    queryFn: () => webhookTargetsClient.detail(id),
    enabled: Number.isInteger(id) && id > 0,
  });
}

// ==================== 变更 ====================

/** 创建 webhook 推送目标 */
export function useCreateWebhookTarget() {
  return useApiMutation<WebhookTargetCreateInput, WebhookTargetResponse>({
    mutationFn: (input) => webhookTargetsClient.create(input),
    invalidates: [webhookTargetsKeys.all],
  });
}

/** 更新指定 webhook 推送目标 */
export function useUpdateWebhookTarget(id: number) {
  return useApiMutation<WebhookTargetUpdateInput, WebhookTargetResponse>({
    mutationFn: (patch) => webhookTargetsClient.update(id, patch),
    invalidates: [webhookTargetsKeys.all],
  });
}

/** 删除指定 webhook 推送目标；input 占位 (void) */
export function useDeleteWebhookTarget(id: number) {
  return useApiMutation<void, void>({
    mutationFn: () => webhookTargetsClient.remove(id),
    invalidates: [webhookTargetsKeys.all],
  });
}

/** 触发 webhook 推送目标测试；不会触发缓存失效之外的副作用 */
export function useTestWebhookTarget(id: number) {
  return useApiMutation<WebhookTargetTestInput, WebhookTargetTestResponse>({
    mutationFn: (body) => webhookTargetsClient.test(id, body),
    invalidates: [webhookTargetsKeys.all],
  });
}
