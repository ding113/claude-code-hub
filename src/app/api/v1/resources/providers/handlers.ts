import type { Context } from "hono";
import type { ZodError } from "zod";
import { z } from "zod";
import type { ActionResult } from "@/actions/types";
import { hasLegacyRedactedWritePlaceholders } from "@/lib/api/legacy-action-sanitizers";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import type { ResolvedAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { withNoStoreHeaders } from "@/lib/api/v1/_shared/cache-control";
import {
  DASHBOARD_COMPAT_HEADER,
  INTERNAL_PROVIDER_TYPE_VALUES,
} from "@/lib/api/v1/_shared/constants";
import {
  createProblemResponse,
  fromZodError,
  publicActionErrorDetail,
} from "@/lib/api/v1/_shared/error-envelope";
import { redactHeaderRecord, redactUrlCredentials } from "@/lib/api/v1/_shared/redaction";
import { parseHonoJsonBody } from "@/lib/api/v1/_shared/request-body";
import {
  createdResponse,
  jsonResponse,
  noContentResponse,
} from "@/lib/api/v1/_shared/response-helpers";
import {
  HIDDEN_PROVIDER_TYPES,
  ProviderApiTestSchema,
  ProviderBatchPatchApplySchema,
  ProviderBatchPatchPreviewSchema,
  ProviderBatchUpdateSchema,
  ProviderConfirmBodySchema,
  ProviderCreateSchema,
  ProviderFetchUpstreamModelsSchema,
  ProviderGroupsQuerySchema,
  ProviderIdsBodySchema,
  ProviderListQuerySchema,
  ProviderModelSuggestionsQuerySchema,
  ProviderProxyTestSchema,
  type ProviderSummaryResponse,
  ProviderTypeQuerySchema,
  ProviderUndoBodySchema,
  ProviderUnifiedTestSchema,
  type ProviderUpdateInput,
  ProviderUpdateSchema,
} from "@/lib/api/v1/schemas/providers";
import type { ProviderDisplay, ProviderStatistics, ProviderStatisticsMap } from "@/types/provider";

const InternalProviderTypeSchema = z.enum(INTERNAL_PROVIDER_TYPE_VALUES);
const InternalProviderListQuerySchema = ProviderListQuerySchema.extend({
  providerType: InternalProviderTypeSchema.optional(),
});
const InternalProviderUpdateSchema = ProviderUpdateSchema.extend({
  provider_type: InternalProviderTypeSchema.optional(),
});
type InternalProviderUpdateInput = z.infer<typeof InternalProviderUpdateSchema>;
type ProviderUpdatePayload = ProviderUpdateInput | InternalProviderUpdateInput;
const InternalProviderTypeQuerySchema = ProviderTypeQuerySchema.extend({
  providerType: InternalProviderTypeSchema,
});
const InternalProviderUnifiedTestSchema = ProviderUnifiedTestSchema.extend({
  providerType: InternalProviderTypeSchema,
});
const InternalProviderFetchUpstreamModelsSchema = ProviderFetchUpstreamModelsSchema.extend({
  providerType: InternalProviderTypeSchema,
});

export async function listProviders(c: Context): Promise<Response> {
  const querySchema = isDashboardCompatRequest(c)
    ? InternalProviderListQuerySchema
    : ProviderListQuerySchema;
  const query = querySchema.safeParse({
    q: c.req.query("q"),
    providerType: c.req.query("providerType"),
    include: c.req.query("include"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const providers = await loadVisibleProviders(c);
  if (providers instanceof Response) return providers;

  let statisticsMap: ProviderStatisticsMap | undefined;
  if (query.data.include === "statistics") {
    const providerActions = await import("@/actions/providers");
    const statsResult = await callAction(
      c,
      providerActions.getProviderStatisticsAsync,
      [] as never[],
      c.get("auth")
    );
    if (!statsResult.ok) return actionError(c, statsResult);
    statisticsMap = statsResult.data;
  }

  return jsonResponse({
    items: filterProviders(providers, query.data).map((p) =>
      sanitizeProvider(p, statisticsMap?.[p.id])
    ),
  });
}

export async function getProvider(c: Context): Promise<Response> {
  const id = Number(c.req.param("id"));
  const provider = await findVisibleProvider(c, id);
  if (provider instanceof Response) return provider;
  if (!provider) return providerNotFound(c);
  return jsonResponse(sanitizeProvider(provider));
}

export async function createProvider(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, ProviderCreateSchema);
  if (!body.ok) return body.response;
  if (hasLegacyRedactedWritePlaceholders(body.data)) {
    return createProblemResponse({
      status: 422,
      instance: new URL(c.req.url).pathname,
      errorCode: "provider.redacted_placeholder_rejected",
      detail: "Redacted placeholders cannot be used when creating providers.",
    });
  }
  const providerActions = await import("@/actions/providers");
  const result = await callAction(
    c,
    providerActions.addProvider,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);

  const createdId = getCreatedProviderId(result.data);
  const created = createdId
    ? await findVisibleProvider(c, createdId)
    : await findCreatedProvider(c, body.data);
  if (created instanceof Response) return created;
  if (!created) {
    return createProblemResponse({
      status: 500,
      instance: new URL(c.req.url).pathname,
      errorCode: "provider.created_resource_unavailable",
      detail: "Provider was created, but the created resource could not be loaded.",
    });
  }
  return createdResponse(sanitizeProvider(created), `/api/v1/providers/${created.id}`);
}

export async function updateProvider(c: Context): Promise<Response> {
  const id = Number(c.req.param("id"));
  const body = await parseHonoJsonBody(
    c,
    isDashboardCompatRequest(c) ? InternalProviderUpdateSchema : ProviderUpdateSchema
  );
  if (!body.ok) return body.response;
  const existing = await findVisibleProvider(c, id);
  if (existing instanceof Response) return existing;
  if (!existing) return providerNotFound(c);
  if (body.data.key !== undefined && hasLegacyRedactedWritePlaceholders(body.data.key)) {
    return createProblemResponse({
      status: 422,
      instance: new URL(c.req.url).pathname,
      errorCode: "provider.redacted_placeholder_rejected",
      detail: "Redacted placeholders cannot be used for the key field when updating providers.",
    });
  }
  if (hasUnresolvedRedactedHeaderEcho(body.data.custom_headers, existing.customHeaders)) {
    return createProblemResponse({
      status: 422,
      instance: new URL(c.req.url).pathname,
      errorCode: "provider.redacted_placeholder_rejected",
      detail: "Redacted placeholders cannot be used for renamed custom header fields.",
    });
  }

  const updatePayload = preserveRedactedProviderUpdateFields(body.data, existing);
  const providerActions = await import("@/actions/providers");
  const result = await callAction(
    c,
    providerActions.editProvider,
    [id, updatePayload] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);

  const updated = await findVisibleProvider(c, id);
  if (updated instanceof Response) return updated;
  return jsonResponse(updated ? sanitizeProvider(updated) : sanitizeProvider(existing), {
    headers: undoMetadataHeaders(result.data),
  });
}

export async function deleteProvider(c: Context): Promise<Response> {
  const id = Number(c.req.param("id"));
  const existing = await findVisibleProvider(c, id);
  if (existing instanceof Response) return existing;
  if (!existing) return providerNotFound(c);

  const providerActions = await import("@/actions/providers");
  const result = await callAction(
    c,
    providerActions.removeProvider,
    [id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse({ headers: undoMetadataHeaders(result.data) });
}

export async function revealProviderKey(c: Context): Promise<Response> {
  const id = Number(c.req.param("id"));
  const provider = await findVisibleProvider(c, id);
  if (provider instanceof Response) return provider;
  if (!provider) return providerNotFound(c);

  const providerActions = await import("@/actions/providers");
  const result = await callAction(
    c,
    providerActions.getUnmaskedProviderKey,
    [id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data, { headers: withNoStoreHeaders() });
}

export async function getProvidersHealth(c: Context): Promise<Response> {
  const providerActions = await import("@/actions/providers");
  const result = await callAction(c, providerActions.getProvidersHealthStatus, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);

  const visibleProviders = await loadVisibleProviders(c);
  if (visibleProviders instanceof Response) return visibleProviders;
  const visibleIds = new Set(visibleProviders.map((provider) => String(provider.id)));
  return jsonResponse(
    Object.fromEntries(
      Object.entries(result.data as Record<string, unknown>).filter(([id]) => visibleIds.has(id))
    )
  );
}

export async function resetProviderCircuit(c: Context): Promise<Response> {
  const id = parseProviderIdWithSuffix(c, "circuit:reset");
  if (id instanceof Response) return id;
  const existing = await findVisibleProvider(c, id);
  if (existing instanceof Response) return existing;
  if (!existing) return providerNotFound(c);
  const providerActions = await import("@/actions/providers");
  const result = await callAction(
    c,
    providerActions.resetProviderCircuit,
    [id] as never[],
    c.get("auth")
  );
  return result.ok ? jsonResponse({ ok: true }) : actionError(c, result);
}

export async function resetProviderUsage(c: Context): Promise<Response> {
  const id = parseProviderIdWithSuffix(c, "usage:reset");
  if (id instanceof Response) return id;
  const existing = await findVisibleProvider(c, id);
  if (existing instanceof Response) return existing;
  if (!existing) return providerNotFound(c);
  const providerActions = await import("@/actions/providers");
  const result = await callAction(
    c,
    providerActions.resetProviderTotalUsage,
    [id] as never[],
    c.get("auth")
  );
  return result.ok ? jsonResponse({ ok: true }) : actionError(c, result);
}

export async function resetProviderCircuitsBatch(c: Context): Promise<Response> {
  const body = await parseJson(c, ProviderIdsBodySchema);
  if (body instanceof Response) return body;
  const visibilityError = await ensureVisibleProviderIds(c, body.providerIds);
  if (visibilityError) return visibilityError;
  const providerActions = await import("@/actions/providers");
  return actionJson(
    c,
    await callAction(
      c,
      providerActions.batchResetProviderCircuits,
      [body] as never[],
      c.get("auth")
    )
  );
}

export async function getProviderLimit(c: Context): Promise<Response> {
  const id = Number(c.req.param("id"));
  const existing = await findVisibleProvider(c, id);
  if (existing instanceof Response) return existing;
  if (!existing) return providerNotFound(c);
  const providerActions = await import("@/actions/providers");
  return actionJson(
    c,
    await callAction(c, providerActions.getProviderLimitUsage, [id] as never[], c.get("auth"))
  );
}

export async function getProviderLimitBatch(c: Context): Promise<Response> {
  const body = await parseJson(c, ProviderIdsBodySchema);
  if (body instanceof Response) return body;
  const visibleProviders = await loadVisibleProviders(c);
  if (visibleProviders instanceof Response) return visibleProviders;
  const providerIds = new Set(body.providerIds);
  const providers = visibleProviders.filter((provider) => providerIds.has(provider.id));
  const providerActions = await import("@/actions/providers");
  const result = await callAction(
    c,
    providerActions.getProviderLimitUsageBatch,
    [providers] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({
    items: Array.from(result.data.entries()).map(([id, usage]) => ({ id, usage })),
  });
}

export async function listProviderGroups(c: Context): Promise<Response> {
  const query = ProviderGroupsQuerySchema.safeParse({
    include: c.req.query("include"),
    userId: c.req.query("userId"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const include = query.data.include;
  const providerActions = await import("@/actions/providers");
  if (include === "count") {
    return actionJson(
      c,
      await callAction(c, providerActions.getProviderGroupsWithCount, [], c.get("auth"))
    );
  }
  const result = await callAction(
    c,
    providerActions.getAvailableProviderGroups,
    query.data.userId ? ([query.data.userId] as never[]) : [],
    c.get("auth")
  );
  return result.ok ? jsonResponse({ items: result.data }) : actionError(c, result);
}

export async function autoSortProviders(c: Context): Promise<Response> {
  const body = await parseJson(c, ProviderConfirmBodySchema);
  if (body instanceof Response) return body;
  const providerActions = await import("@/actions/providers");
  return actionJson(
    c,
    await callAction(c, providerActions.autoSortProviderPriority, [body] as never[], c.get("auth"))
  );
}

export async function batchUpdateProviders(c: Context): Promise<Response> {
  const body = await parseJson(c, ProviderBatchUpdateSchema);
  if (body instanceof Response) return body;
  const visibilityError = await ensureVisibleProviderIds(c, body.providerIds);
  if (visibilityError) return visibilityError;
  const providerActions = await import("@/actions/providers");
  return actionJson(
    c,
    await callAction(c, providerActions.batchUpdateProviders, [body] as never[], c.get("auth"))
  );
}

export async function batchDeleteProviders(c: Context): Promise<Response> {
  const body = await parseJson(c, ProviderIdsBodySchema);
  if (body instanceof Response) return body;
  const visibilityError = await ensureVisibleProviderIds(c, body.providerIds);
  if (visibilityError) return visibilityError;
  const providerActions = await import("@/actions/providers");
  return actionJson(
    c,
    await callAction(c, providerActions.batchDeleteProviders, [body] as never[], c.get("auth"))
  );
}

export async function undoDeleteProvider(c: Context): Promise<Response> {
  const body = await parseJson(c, ProviderUndoBodySchema);
  if (body instanceof Response) return body;
  const providerActions = await import("@/actions/providers");
  return actionJson(
    c,
    await callAction(c, providerActions.undoProviderDelete, [body] as never[], c.get("auth"))
  );
}

export async function previewBatchPatch(c: Context): Promise<Response> {
  const body = await parseJson(c, ProviderBatchPatchPreviewSchema);
  if (body instanceof Response) return body;
  const visibilityError = await ensureVisibleProviderIds(c, body.providerIds);
  if (visibilityError) return visibilityError;
  const providerActions = await import("@/actions/providers");
  return actionJson(
    c,
    await callAction(c, providerActions.previewProviderBatchPatch, [body] as never[], c.get("auth"))
  );
}

export async function applyBatchPatch(c: Context): Promise<Response> {
  const body = await parseJson(c, ProviderBatchPatchApplySchema);
  if (body instanceof Response) return body;
  const visibilityError = await ensureVisibleProviderIds(c, body.providerIds);
  if (visibilityError) return visibilityError;
  const providerActions = await import("@/actions/providers");
  return actionJson(
    c,
    await callAction(c, providerActions.applyProviderBatchPatch, [body] as never[], c.get("auth"))
  );
}

export async function undoProviderBatchPatch(c: Context): Promise<Response> {
  const body = await parseJson(c, ProviderUndoBodySchema);
  if (body instanceof Response) return body;
  const providerActions = await import("@/actions/providers");
  return actionJson(
    c,
    await callAction(c, providerActions.undoProviderPatch, [body] as never[], c.get("auth"))
  );
}

export async function testProviderProxy(c: Context): Promise<Response> {
  return callProviderTest(c, ProviderProxyTestSchema, "testProviderProxy");
}

export async function testProviderUnified(c: Context): Promise<Response> {
  return callProviderTest(
    c,
    isDashboardCompatRequest(c) ? InternalProviderUnifiedTestSchema : ProviderUnifiedTestSchema,
    "testProviderUnified"
  );
}

export async function testProviderAnthropic(c: Context): Promise<Response> {
  return callProviderTest(c, ProviderApiTestSchema, "testProviderAnthropicMessages");
}

export async function testProviderOpenAIChat(c: Context): Promise<Response> {
  return callProviderTest(c, ProviderApiTestSchema, "testProviderOpenAIChatCompletions");
}

export async function testProviderOpenAIResponses(c: Context): Promise<Response> {
  return callProviderTest(c, ProviderApiTestSchema, "testProviderOpenAIResponses");
}

export async function testProviderGemini(c: Context): Promise<Response> {
  return callProviderTest(c, ProviderApiTestSchema, "testProviderGemini");
}

export async function getProviderTestPresets(c: Context): Promise<Response> {
  const query = (
    isDashboardCompatRequest(c) ? InternalProviderTypeQuerySchema : ProviderTypeQuerySchema
  ).safeParse({ providerType: c.req.query("providerType") });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const providerActions = await import("@/actions/providers");
  return actionJson(
    c,
    await callAction(
      c,
      providerActions.getProviderTestPresets,
      [query.data.providerType] as never[],
      c.get("auth")
    )
  );
}

export async function fetchProviderUpstreamModels(c: Context): Promise<Response> {
  const body = await parseJson(
    c,
    isDashboardCompatRequest(c)
      ? InternalProviderFetchUpstreamModelsSchema
      : ProviderFetchUpstreamModelsSchema
  );
  if (body instanceof Response) return body;
  const providerActions = await import("@/actions/providers");
  return actionJson(
    c,
    await callAction(c, providerActions.fetchUpstreamModels, [body] as never[], c.get("auth"))
  );
}

export async function getProviderModelSuggestions(c: Context): Promise<Response> {
  const query = ProviderModelSuggestionsQuerySchema.safeParse({
    providerGroup: c.req.query("providerGroup"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const providerActions = await import("@/actions/providers");
  return actionJson(
    c,
    await callAction(
      c,
      providerActions.getModelSuggestionsByProviderGroup,
      [query.data.providerGroup] as never[],
      c.get("auth")
    )
  );
}

export async function reclusterProviderVendors(c: Context): Promise<Response> {
  const body = await parseJson(c, ProviderConfirmBodySchema);
  if (body instanceof Response) return body;
  const providerActions = await import("@/actions/providers");
  return actionJson(
    c,
    await callAction(c, providerActions.reclusterProviderVendors, [body] as never[], c.get("auth"))
  );
}

async function loadVisibleProviders(c: Context): Promise<ProviderDisplay[] | Response> {
  const providerActions = await import("@/actions/providers");
  const result = await callAction(c, providerActions.getProviders, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  if (isDashboardCompatRequest(c)) return result.data;
  return result.data.filter(
    (provider) => !HIDDEN_PROVIDER_TYPES.has(provider.providerType as never)
  );
}

function isDashboardCompatRequest(c: Context): boolean {
  const auth = c.get("auth") as ResolvedAuth | undefined;
  return c.req.header(DASHBOARD_COMPAT_HEADER) === "1" && auth?.session?.user.role === "admin";
}

async function findVisibleProvider(
  c: Context,
  id: number
): Promise<ProviderDisplay | undefined | Response> {
  const providers = await loadVisibleProviders(c);
  if (providers instanceof Response) return providers;
  return providers.find((provider) => provider.id === id);
}

async function ensureVisibleProviderIds(c: Context, ids: number[]): Promise<Response | null> {
  const providers = await loadVisibleProviders(c);
  if (providers instanceof Response) return providers;
  const visibleIds = new Set(providers.map((provider) => provider.id));
  return ids.every((id) => visibleIds.has(id)) ? null : providerNotFound(c);
}

async function findCreatedProvider(
  c: Context,
  input: { name: string; url: string; provider_type?: string }
): Promise<ProviderDisplay | undefined | Response> {
  const providers = await loadVisibleProviders(c);
  if (providers instanceof Response) return providers;
  return providers.find(
    (provider) =>
      provider.name === input.name &&
      provider.url === input.url &&
      provider.providerType === (input.provider_type ?? "claude")
  );
}

function getCreatedProviderId(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

function undoMetadataHeaders(data: unknown): HeadersInit {
  if (!data || typeof data !== "object") return {};
  const undoToken = (data as { undoToken?: unknown }).undoToken;
  const operationId = (data as { operationId?: unknown }).operationId;
  return {
    ...(typeof undoToken === "string" ? { "X-CCH-Undo-Token": undoToken } : {}),
    ...(typeof operationId === "string" ? { "X-CCH-Operation-Id": operationId } : {}),
  };
}

function filterProviders(
  providers: ProviderDisplay[],
  query: { q?: string; providerType?: string; include?: "statistics" }
): ProviderDisplay[] {
  const normalizedQuery = query.q?.toLowerCase();
  return providers.filter((provider) => {
    if (query.providerType && provider.providerType !== query.providerType) return false;
    if (!normalizedQuery) return true;
    return [provider.name, provider.url, provider.groupTag, provider.providerType]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery));
  });
}

function sanitizeProvider(
  provider: ProviderDisplay,
  statistics?: ProviderStatistics
): ProviderSummaryResponse {
  return {
    id: provider.id,
    name: provider.name,
    url: redactUrlCredentials(provider.url) ?? provider.url,
    maskedKey: provider.maskedKey,
    isEnabled: provider.isEnabled,
    weight: provider.weight,
    priority: provider.priority,
    groupPriorities: provider.groupPriorities,
    costMultiplier: provider.costMultiplier,
    groupTag: provider.groupTag,
    providerType: provider.providerType as ProviderSummaryResponse["providerType"],
    providerVendorId: provider.providerVendorId,
    preserveClientIp: provider.preserveClientIp,
    disableSessionReuse: provider.disableSessionReuse,
    modelRedirects: provider.modelRedirects,
    activeTimeStart: provider.activeTimeStart,
    activeTimeEnd: provider.activeTimeEnd,
    allowedModels: provider.allowedModels,
    allowedClients: provider.allowedClients,
    blockedClients: provider.blockedClients,
    mcpPassthroughType: provider.mcpPassthroughType,
    mcpPassthroughUrl: redactUrlCredentials(provider.mcpPassthroughUrl),
    limit5hUsd: provider.limit5hUsd,
    limit5hResetMode: provider.limit5hResetMode,
    limitDailyUsd: provider.limitDailyUsd,
    dailyResetMode: provider.dailyResetMode,
    dailyResetTime: provider.dailyResetTime,
    limitWeeklyUsd: provider.limitWeeklyUsd,
    limitMonthlyUsd: provider.limitMonthlyUsd,
    limitTotalUsd: provider.limitTotalUsd,
    totalCostResetAt: provider.totalCostResetAt?.toISOString() ?? null,
    limitConcurrentSessions: provider.limitConcurrentSessions,
    maxRetryAttempts: provider.maxRetryAttempts,
    circuitBreakerFailureThreshold: provider.circuitBreakerFailureThreshold,
    circuitBreakerOpenDuration: provider.circuitBreakerOpenDuration,
    circuitBreakerHalfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
    proxyUrl: redactUrlCredentials(provider.proxyUrl),
    proxyFallbackToDirect: provider.proxyFallbackToDirect,
    customHeaders: redactHeaderRecord(provider.customHeaders),
    firstByteTimeoutStreamingMs: provider.firstByteTimeoutStreamingMs,
    streamingIdleTimeoutMs: provider.streamingIdleTimeoutMs,
    requestTimeoutNonStreamingMs: provider.requestTimeoutNonStreamingMs,
    websiteUrl: redactUrlCredentials(provider.websiteUrl) ?? provider.websiteUrl,
    faviconUrl: provider.faviconUrl,
    cacheTtlPreference: provider.cacheTtlPreference,
    swapCacheTtlBilling: provider.swapCacheTtlBilling,
    context1mPreference: provider.context1mPreference,
    codexReasoningEffortPreference: provider.codexReasoningEffortPreference,
    codexReasoningSummaryPreference: provider.codexReasoningSummaryPreference,
    codexTextVerbosityPreference: provider.codexTextVerbosityPreference,
    codexParallelToolCallsPreference: provider.codexParallelToolCallsPreference,
    codexServiceTierPreference: provider.codexServiceTierPreference,
    anthropicMaxTokensPreference: provider.anthropicMaxTokensPreference,
    anthropicThinkingBudgetPreference: provider.anthropicThinkingBudgetPreference,
    anthropicAdaptiveThinking: provider.anthropicAdaptiveThinking,
    geminiGoogleSearchPreference: provider.geminiGoogleSearchPreference,
    todayTotalCostUsd: provider.todayTotalCostUsd,
    todayCallCount: provider.todayCallCount,
    lastCallTime: provider.lastCallTime,
    lastCallModel: provider.lastCallModel,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
    ...(statistics ? { statistics } : {}),
  };
}

function preserveRedactedProviderUpdateFields<T extends ProviderUpdatePayload>(
  input: T,
  existing: ProviderDisplay
): T {
  const next: T = { ...input };
  const urlFields = [
    ["url", "url"],
    ["proxy_url", "proxyUrl"],
    ["website_url", "websiteUrl"],
    ["mcp_passthrough_url", "mcpPassthroughUrl"],
  ] as const;

  for (const [inputKey, providerKey] of urlFields) {
    if (isRedactedUrlEcho(next[inputKey], existing[providerKey])) {
      delete next[inputKey];
    }
  }

  if (next.custom_headers && existing.customHeaders) {
    next.custom_headers = restoreRedactedHeaderValues(next.custom_headers, existing.customHeaders);
  }

  return next;
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

function providerNotFound(c: Context): Response {
  return createProblemResponse({
    status: 404,
    instance: new URL(c.req.url).pathname,
    errorCode: "provider.not_found",
    detail: "Provider was not found.",
  });
}

type JsonBodySchema<T> = {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: ZodError };
};

async function parseJson<T>(c: Context, schema: JsonBodySchema<T>): Promise<T | Response> {
  const body = await parseHonoJsonBody(c, schema);
  if (!body.ok) return body.response;
  return body.data;
}

function parseProviderIdWithSuffix(c: Context, suffix: string): number | Response {
  const raw = (c.req.param("id") ?? "").replace(new RegExp(`:${suffix.replace(":", "\\:")}$`), "");
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return createProblemResponse({
      status: 400,
      instance: new URL(c.req.url).pathname,
      errorCode: "request.validation_failed",
      detail: "Provider id is invalid.",
    });
  }
  return id;
}

function actionJson<T>(c: Context, result: ActionResult<T>): Response {
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data ?? { ok: true });
}

async function callProviderTest(
  c: Context,
  schema:
    | typeof ProviderProxyTestSchema
    | typeof ProviderApiTestSchema
    | typeof ProviderUnifiedTestSchema,
  actionName:
    | "testProviderProxy"
    | "testProviderUnified"
    | "testProviderAnthropicMessages"
    | "testProviderOpenAIChatCompletions"
    | "testProviderOpenAIResponses"
    | "testProviderGemini"
): Promise<Response> {
  const body = await parseJson(c, schema);
  if (body instanceof Response) return body;
  const providerActions = await import("@/actions/providers");
  return actionJson(
    c,
    await callAction(c, providerActions[actionName], [body] as never[], c.get("auth"))
  );
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const status = statusFromActionError(result);
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode:
      result.errorCode ?? (status === 404 ? "provider.not_found" : "provider.action_failed"),
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}

function statusFromActionError(result: Extract<ActionResult<unknown>, { ok: false }>) {
  switch (result.errorCode) {
    case "NOT_FOUND":
    case "PROVIDER_NOT_FOUND":
    case "resource.not_found":
    case "provider.not_found":
      return 404;
    case "PERMISSION_DENIED":
    case "UNAUTHORIZED":
    case "auth.forbidden":
      return 403;
    case "CONFLICT":
    case "UNDO_CONFLICT":
    case "PREVIEW_STALE":
    case "resource.conflict":
      return 409;
    case "UNDO_EXPIRED":
    case "PREVIEW_EXPIRED":
      return 410;
    default:
      return result.error.includes("不存在") ? 404 : result.error.includes("权限") ? 403 : 400;
  }
}
