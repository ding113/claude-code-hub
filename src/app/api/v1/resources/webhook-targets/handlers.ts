import type { Context } from "hono";
import type { ActionResult } from "@/actions/types";
import { hasLegacyRedactedWritePlaceholders } from "@/lib/api/legacy-action-sanitizers";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import {
  createProblemResponse,
  publicActionErrorDetail,
} from "@/lib/api/v1/_shared/error-envelope";
import { redactHeaderRecord, redactUrlCredentials } from "@/lib/api/v1/_shared/redaction";
import { parseHonoJsonBody } from "@/lib/api/v1/_shared/request-body";
import { jsonResponse, noContentResponse } from "@/lib/api/v1/_shared/response-helpers";
import {
  WebhookTargetCreateSchema,
  WebhookTargetTestRequestSchema,
  type WebhookTargetUpdateInput,
  WebhookTargetUpdateSchema,
} from "@/lib/api/v1/schemas/webhook-targets";
import type { WebhookTarget } from "@/repository/webhook-targets";

export async function listWebhookTargets(c: Context): Promise<Response> {
  const webhookTargetActions = await import("@/actions/webhook-targets");
  const result = await callAction(
    c,
    webhookTargetActions.getWebhookTargetsAction,
    [],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data.map(sanitizeWebhookTarget) });
}

export async function getWebhookTarget(c: Context): Promise<Response> {
  const id = Number(c.req.param("id"));
  const webhookTargetActions = await import("@/actions/webhook-targets");
  const result = await callAction(
    c,
    webhookTargetActions.getWebhookTargetsAction,
    [],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  const target = result.data.find((item) => item.id === id);
  if (!target) {
    return createProblemResponse({
      status: 404,
      instance: new URL(c.req.url).pathname,
      errorCode: "webhook_target.not_found",
      detail: "Webhook target was not found.",
    });
  }
  return jsonResponse(sanitizeWebhookTarget(target));
}

export async function createWebhookTarget(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, WebhookTargetCreateSchema);
  if (!body.ok) return body.response;
  if (hasLegacyRedactedWritePlaceholders(body.data)) {
    return createProblemResponse({
      status: 422,
      instance: new URL(c.req.url).pathname,
      errorCode: "webhook_target.redacted_placeholder_rejected",
      detail: "Redacted placeholders cannot be used when creating webhook targets.",
    });
  }

  const webhookTargetActions = await import("@/actions/webhook-targets");
  const result = await callAction(
    c,
    webhookTargetActions.createWebhookTargetAction,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(sanitizeWebhookTarget(result.data), {
    status: 201,
    headers: { Location: `/api/v1/webhook-targets/${result.data.id}` },
  });
}

export async function updateWebhookTarget(c: Context): Promise<Response> {
  const id = Number(c.req.param("id"));
  const body = await parseHonoJsonBody(c, WebhookTargetUpdateSchema);
  if (!body.ok) return body.response;

  const webhookTargetActions = await import("@/actions/webhook-targets");
  const existingResult = await callAction(
    c,
    webhookTargetActions.getWebhookTargetsAction,
    [],
    c.get("auth")
  );
  if (!existingResult.ok) return actionError(c, existingResult);
  const existing = existingResult.data.find((item) => item.id === id);
  if (!existing) {
    return createProblemResponse({
      status: 404,
      instance: new URL(c.req.url).pathname,
      errorCode: "webhook_target.not_found",
      detail: "Webhook target was not found.",
    });
  }
  if (hasUnresolvedRedactedHeaderEcho(body.data.customHeaders, existing.customHeaders)) {
    return createProblemResponse({
      status: 422,
      instance: new URL(c.req.url).pathname,
      errorCode: "webhook_target.redacted_placeholder_rejected",
      detail: "Redacted placeholders cannot be used for renamed custom header fields.",
    });
  }
  const updatePayload = preserveRedactedWebhookTargetUpdateFields(body.data, existing);
  const result = await callAction(
    c,
    webhookTargetActions.updateWebhookTargetAction,
    [id, updatePayload] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(sanitizeWebhookTarget(result.data));
}

export async function deleteWebhookTarget(c: Context): Promise<Response> {
  const id = Number(c.req.param("id"));
  const webhookTargetActions = await import("@/actions/webhook-targets");
  const result = await callAction(
    c,
    webhookTargetActions.deleteWebhookTargetAction,
    [id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function testWebhookTarget(c: Context): Promise<Response> {
  const id = Number((c.req.param("id") ?? "").replace(/:test$/, ""));
  const body = await parseHonoJsonBody(c, WebhookTargetTestRequestSchema);
  if (!body.ok) return body.response;

  const webhookTargetActions = await import("@/actions/webhook-targets");
  const result = await callAction(
    c,
    webhookTargetActions.testWebhookTargetAction,
    [id, body.data.notificationType] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

function sanitizeWebhookTarget(target: WebhookTarget) {
  return {
    ...target,
    webhookUrl: target.webhookUrl ? "[REDACTED]" : null,
    customHeaders: redactHeaderRecord(target.customHeaders),
    proxyUrl: redactUrlCredentials(target.proxyUrl),
    telegramBotToken: null,
    dingtalkSecret: null,
  };
}

function preserveRedactedWebhookTargetUpdateFields(
  input: WebhookTargetUpdateInput,
  existing: WebhookTarget
): WebhookTargetUpdateInput {
  const next: WebhookTargetUpdateInput = { ...input };
  const nextProviderType = next.providerType ?? existing.providerType;

  if (next.webhookUrl === "[REDACTED]" && existing.webhookUrl) {
    delete next.webhookUrl;
  }

  if (isRedactedUrlEcho(next.proxyUrl, existing.proxyUrl)) {
    delete next.proxyUrl;
  }

  if (
    nextProviderType === "telegram" &&
    isEmptySecretEcho(next.telegramBotToken) &&
    existing.telegramBotToken
  ) {
    delete next.telegramBotToken;
  }

  if (
    nextProviderType === "dingtalk" &&
    isEmptySecretEcho(next.dingtalkSecret) &&
    existing.dingtalkSecret
  ) {
    delete next.dingtalkSecret;
  }

  if (next.customHeaders && existing.customHeaders) {
    next.customHeaders = restoreRedactedHeaderValues(next.customHeaders, existing.customHeaders);
  }

  return next;
}

function isEmptySecretEcho(value: unknown): boolean {
  return value === "";
}

function isRedactedUrlEcho(value: unknown, existing: string | null | undefined): boolean {
  if (typeof value !== "string" || !existing) return false;
  const redactedExisting = redactUrlCredentials(existing);
  return redactedExisting !== existing && redactedExisting === value;
}

function restoreRedactedHeaderValues(
  incoming: Record<string, string>,
  existing: Record<string, string>
): Record<string, string> {
  const redactedExisting = redactHeaderRecord(existing) ?? {};
  const existingByLowerName = new Map(
    Object.entries(existing).map(([name, value]) => [name.toLowerCase(), value])
  );
  const redactedExistingByLowerName = new Map(
    Object.entries(redactedExisting).map(([name, value]) => [name.toLowerCase(), value])
  );

  return Object.fromEntries(
    Object.entries(incoming).map(([name, value]) => [
      name,
      value === "[REDACTED]" &&
      (redactedExisting[name] === "[REDACTED]" ||
        redactedExistingByLowerName.get(name.toLowerCase()) === "[REDACTED]")
        ? (existing[name] ?? existingByLowerName.get(name.toLowerCase()) ?? value)
        : value,
    ])
  );
}

function hasUnresolvedRedactedHeaderEcho(
  incoming: Record<string, string> | null | undefined,
  existing: Record<string, string> | null | undefined
): boolean {
  if (!incoming) return false;
  const redactedExisting = existing ? (redactHeaderRecord(existing) ?? {}) : {};
  const redactedExistingNames = new Set(
    Object.entries(redactedExisting)
      .filter(([, value]) => value === "[REDACTED]")
      .map(([name]) => name.toLowerCase())
  );

  return Object.entries(incoming).some(
    ([name, value]) => value === "[REDACTED]" && !redactedExistingNames.has(name.toLowerCase())
  );
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const status = detail.includes("不存在") ? 404 : detail.includes("权限") ? 403 : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: result.errorCode ?? "webhook_target.action_failed",
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
