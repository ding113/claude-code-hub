import type { WebhookTarget } from "@/repository/webhook-targets";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  toActionResult,
  toVoidActionResult,
  unwrapItems,
} from "./_compat";

export function getWebhookTargetsAction() {
  return toActionResult(
    apiGet<{ items?: WebhookTarget[] }>("/api/v1/webhook-targets").then(unwrapItems)
  );
}

export function createWebhookTargetAction(data: unknown) {
  return toActionResult(apiPost<WebhookTarget>("/api/v1/webhook-targets", data));
}

export function updateWebhookTargetAction(id: number, data: unknown) {
  return toActionResult(apiPatch<WebhookTarget>(`/api/v1/webhook-targets/${id}`, data));
}

export function deleteWebhookTargetAction(id: number) {
  return toVoidActionResult(apiDelete(`/api/v1/webhook-targets/${id}`));
}

export function testWebhookTargetAction(id: number, notificationType: string) {
  return toActionResult(
    apiPost<{ latencyMs: number }>(`/api/v1/webhook-targets/${id}:test`, { notificationType })
  );
}
