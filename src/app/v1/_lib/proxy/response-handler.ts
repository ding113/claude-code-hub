import { ResponseFixer } from "@/app/v1/_lib/proxy/response-fixer";
import { AsyncTaskManager } from "@/lib/async-task-manager";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import { requestCloudPriceTableSync } from "@/lib/price-sync/cloud-price-updater";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";
import { RateLimitService } from "@/lib/rate-limit";
import { deleteLiveChain } from "@/lib/redis/live-chain-store";
import { SessionManager } from "@/lib/session-manager";
import { SessionTracker } from "@/lib/session-tracker";
import { CODEX_1M_CONTEXT_TOKEN_THRESHOLD } from "@/lib/special-attributes";
import type {
  CostBreakdown,
  RequestCostCalculationOptions,
  ResolvedLongContextPricing,
} from "@/lib/utils/cost-calculation";
import {
  calculateRequestCost,
  calculateRequestCostBreakdown,
  matchLongContextPricing,
  sanitizeMultiplier,
} from "@/lib/utils/cost-calculation";
import { COST_SCALE, Decimal } from "@/lib/utils/currency";
import { isNonBillingEndpoint } from "@/lib/utils/performance-formatter";
import { hasValidPriceData } from "@/lib/utils/price-data";
import { isSSEText, parseSSEData } from "@/lib/utils/sse";
import {
  detectUpstreamErrorFromSseOrJsonText,
  inferUpstreamErrorStatusCodeFromText,
} from "@/lib/utils/upstream-error-detection";
import {
  updateMessageRequestCostWithBreakdown,
  updateMessageRequestDetails,
  updateMessageRequestDuration,
} from "@/repository/message";
import type { StoredCostBreakdown } from "@/types/cost-breakdown";
import type { Provider } from "@/types/provider";
import type { SessionUsageUpdate } from "@/types/session";
import type { LongContextPricingSpecialSetting } from "@/types/special-settings";
import { GeminiAdapter } from "../gemini/adapter";
import type { GeminiResponse } from "../gemini/types";
import { extractActualResponseModelForProvider } from "./actual-response-model";
import { bindClientAbortListener } from "./client-abort-listener";
import { isClientAbortError, isTransportError } from "./errors";
import type { ProxySession } from "./session";
import { consumeDeferredStreamingFinalization } from "./stream-finalization";

/**
 * Idempotent helper to release the agent pool reference count attached to a session.
 * Prevents double-release by clearing the callback after first invocation.
 */
function releaseSessionAgent(session: ProxySession): void {
  const s = session as ProxySession & { releaseAgent?: () => void };
  if (s.releaseAgent) {
    try {
      s.releaseAgent();
    } catch {
      // ignore - agent may already be evicted
    }
    s.releaseAgent = undefined;
  }
}

function takeBeforeResponseBodySnapshotSource(session: ProxySession): Response | null {
  const snapshotSession = session as ProxySession & {
    detailSnapshotResponseBeforeSource?: Response | null;
  };
  const source = snapshotSession.detailSnapshotResponseBeforeSource;
  snapshotSession.detailSnapshotResponseBeforeSource = null;
  return source ?? null;
}

async function consumeBeforeResponseBodySnapshot(session: ProxySession): Promise<string | null> {
  const source = takeBeforeResponseBodySnapshotSource(session);
  if (!source) return null;

  try {
    return await source.text();
  } catch (error) {
    logger.warn("[ResponseHandler] Failed to read before-response snapshot body", {
      sessionId: session.sessionId ?? null,
      requestSequence: session.requestSequence ?? null,
      error,
    });
    return null;
  }
}

function discardBeforeResponseBodySnapshot(session: ProxySession): void {
  const source = takeBeforeResponseBodySnapshotSource(session);
  if (!source?.body) return;

  void source.body.cancel().catch((error) => {
    logger.warn("[ResponseHandler] Failed to discard before-response snapshot body", {
      sessionId: session.sessionId ?? null,
      requestSequence: session.requestSequence ?? null,
      error,
    });
  });
}

export type UsageMetrics = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation_5m_input_tokens?: number;
  cache_creation_1h_input_tokens?: number;
  cache_ttl?: "5m" | "1h" | "mixed";
  cache_read_input_tokens?: number;
  // 图片 modality tokens（从 candidatesTokensDetails/promptTokensDetails 提取）
  input_image_tokens?: number;
  output_image_tokens?: number;
};

function maybeSetCodexContext1m(
  session: ProxySession,
  provider: Provider,
  inputTokens: number | null | undefined
): void {
  if (
    provider.providerType === "codex" &&
    inputTokens != null &&
    inputTokens > CODEX_1M_CONTEXT_TOKEN_THRESHOLD
  ) {
    session.setContext1mApplied(true);
  }
}

/**
 * Fire Langfuse trace asynchronously. Non-blocking, error-tolerant.
 */
function emitLangfuseTrace(
  session: ProxySession,
  data: {
    responseHeaders: Headers;
    responseText: string;
    usageMetrics: UsageMetrics | null;
    costUsd: string | undefined;
    costBreakdown?: CostBreakdown;
    statusCode: number;
    durationMs: number;
    isStreaming: boolean;
    sseEventCount?: number;
    errorMessage?: string;
  }
): void {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return;

  void import("@/lib/langfuse/trace-proxy-request")
    .then(({ traceProxyRequest }) => {
      void traceProxyRequest({
        session,
        responseHeaders: data.responseHeaders,
        durationMs: data.durationMs,
        statusCode: data.statusCode,
        isStreaming: data.isStreaming,
        responseText: data.responseText,
        usageMetrics: data.usageMetrics,
        costUsd: data.costUsd,
        costBreakdown: data.costBreakdown,
        sseEventCount: data.sseEventCount,
        errorMessage: data.errorMessage,
      });
    })
    .catch((err) => {
      logger.warn("[ResponseHandler] Langfuse trace failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * 清理 Response headers 中的传输相关 header
 *
 * 原因：Bun 的 Response API 在接收 ReadableStream 或修改后的 body 时，
 * 会自动添加 Transfer-Encoding: chunked 和 Content-Length，
 * 如果不清理原始 headers 中的这些字段，会导致重复 header 错误。
 *
 * Node.js 运行时会智能去重，但 Bun 不会，所以需要手动清理。
 *
 * @param headers - 原始响应 headers
 * @returns 清理后的 headers
 */
function cleanResponseHeaders(headers: Headers): Headers {
  const cleaned = new Headers(headers);

  // 删除传输相关 headers，让 Response API 自动管理
  cleaned.delete("transfer-encoding"); // Bun 会根据 body 类型自动添加
  cleaned.delete("content-length"); // body 改变后长度无效，Response API 会重新计算

  return cleaned;
}

function ensurePricingResolutionSpecialSetting(
  session: ProxySession,
  resolvedPricing: Awaited<ReturnType<ProxySession["getResolvedPricingByBillingSource"]>>
): void {
  if (!resolvedPricing) return;

  const existing = session
    .getSpecialSettings()
    ?.find(
      (setting) =>
        setting.type === "pricing_resolution" &&
        setting.resolvedModelName === resolvedPricing.resolvedModelName &&
        setting.resolvedPricingProviderKey === resolvedPricing.resolvedPricingProviderKey &&
        setting.source === resolvedPricing.source
    );

  if (existing) return;

  session.addSpecialSetting({
    type: "pricing_resolution",
    scope: "billing",
    hit: true,
    modelName: session.getCurrentModel() ?? resolvedPricing.resolvedModelName,
    resolvedModelName: resolvedPricing.resolvedModelName,
    resolvedPricingProviderKey: resolvedPricing.resolvedPricingProviderKey,
    source: resolvedPricing.source,
  });
}

function getRequestedCodexServiceTier(session: ProxySession): string | null {
  if (session.provider?.providerType !== "codex") {
    return null;
  }

  const request = session.request.message as Record<string, unknown>;
  return typeof request.service_tier === "string" ? request.service_tier : null;
}

export function parseServiceTierFromResponseText(responseText: string): string | null {
  let lastSeenServiceTier: string | null = null;

  const applyValue = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      lastSeenServiceTier = value.trim();
    }
  };

  try {
    const parsedValue = JSON.parse(responseText);
    if (parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)) {
      const parsed = parsedValue as Record<string, unknown>;
      applyValue(parsed.service_tier);
      if (parsed.response && typeof parsed.response === "object") {
        applyValue((parsed.response as Record<string, unknown>).service_tier);
      }
    }
  } catch {
    // ignore, fallback to SSE parsing below
  }

  if (lastSeenServiceTier) {
    return lastSeenServiceTier;
  }

  if (isSSEText(responseText)) {
    const events = parseSSEData(responseText);
    for (const event of events) {
      if (!event.data || typeof event.data !== "object") continue;
      const data = event.data as Record<string, unknown>;
      applyValue(data.service_tier);
      if (data.response && typeof data.response === "object") {
        applyValue((data.response as Record<string, unknown>).service_tier);
      }
    }
  }

  return lastSeenServiceTier;
}

type CodexPriorityBillingDecision = {
  requestedServiceTier: string | null;
  actualServiceTier: string | null;
  billingSourcePreference: Awaited<ReturnType<ProxySession["getCodexPriorityBillingSource"]>>;
  resolvedFrom: "requested" | "actual" | null;
  effectivePriority: boolean;
};

async function resolveCodexPriorityBillingDecision(
  session: ProxySession,
  actualServiceTier: string | null
): Promise<CodexPriorityBillingDecision | null> {
  if (session.provider?.providerType !== "codex") {
    return null;
  }

  const requestedServiceTier = getRequestedCodexServiceTier(session);
  let billingSourcePreference: Awaited<ReturnType<ProxySession["getCodexPriorityBillingSource"]>> =
    "requested";

  try {
    billingSourcePreference = await session.getCodexPriorityBillingSource();
  } catch (error) {
    logger.warn(
      "[ResponseHandler] Failed to load codex priority billing source, fallback to requested",
      {
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }

  let resolvedFrom: "requested" | "actual" | null = null;
  let effectiveTier: string | null = null;

  if (billingSourcePreference === "actual") {
    if (actualServiceTier != null) {
      resolvedFrom = "actual";
      effectiveTier = actualServiceTier;
    } else if (requestedServiceTier != null) {
      resolvedFrom = "requested";
      effectiveTier = requestedServiceTier;
    }
  } else if (requestedServiceTier != null) {
    resolvedFrom = "requested";
    effectiveTier = requestedServiceTier;
  }

  return {
    requestedServiceTier,
    actualServiceTier,
    billingSourcePreference,
    resolvedFrom,
    effectivePriority: effectiveTier === "priority",
  };
}

function ensureCodexServiceTierResultSpecialSetting(
  session: ProxySession,
  decision: CodexPriorityBillingDecision | null
): void {
  if (!decision) {
    return;
  }

  const existing = session
    .getSpecialSettings()
    ?.find((setting) => setting.type === "codex_service_tier_result");

  if (existing && existing.type === "codex_service_tier_result") {
    return;
  }

  session.addSpecialSetting({
    type: "codex_service_tier_result",
    scope: "response",
    hit:
      decision.effectivePriority ||
      decision.requestedServiceTier != null ||
      decision.actualServiceTier != null,
    requestedServiceTier: decision.requestedServiceTier,
    actualServiceTier: decision.actualServiceTier,
    billingSourcePreference: decision.billingSourcePreference,
    resolvedFrom: decision.resolvedFrom,
    effectivePriority: decision.effectivePriority,
  });
}

function createLongContextPricingAudit(
  pricing: ResolvedLongContextPricing
): LongContextPricingSpecialSetting {
  return {
    type: "long_context_pricing",
    scope: "billing",
    hit: true,
    pricingScope: pricing.scope,
    thresholdTokens: pricing.thresholdTokens,
  };
}

function ensureLongContextPricingAudit(
  session: ProxySession,
  pricing: ResolvedLongContextPricing | null
): void {
  if (!pricing) {
    return;
  }

  const existing = session
    .getSpecialSettings()
    ?.find(
      (setting) =>
        setting.type === "long_context_pricing" &&
        setting.pricingScope === pricing.scope &&
        setting.thresholdTokens === pricing.thresholdTokens
    );

  if (!existing) {
    session.addSpecialSetting(createLongContextPricingAudit(pricing));
  }
}

function buildCostCalculationOptions(
  costMultiplier: number,
  context1mApplied: boolean,
  priorityServiceTierApplied: boolean,
  longContextPricing: ResolvedLongContextPricing | null,
  groupCostMultiplier: number = 1
): RequestCostCalculationOptions {
  return {
    multiplier: costMultiplier,
    groupMultiplier: groupCostMultiplier,
    context1mApplied,
    priorityServiceTierApplied,
    longContextPricing,
  };
}

function isNonBillingUsageEndpoint(session: ProxySession): boolean {
  return isNonBillingEndpoint(session.getEndpoint());
}

function hasBillableInputCostPerRequest(priceData: { input_cost_per_request?: unknown }): boolean {
  const inputCostPerRequest = priceData.input_cost_per_request;
  return (
    typeof inputCostPerRequest === "number" &&
    Number.isFinite(inputCostPerRequest) &&
    inputCostPerRequest >= 0
  );
}

async function resolveBillableUsageMetricsForCost(
  session: ProxySession,
  provider: Provider | null,
  usageMetrics: UsageMetrics | null,
  statusCode: number
): Promise<UsageMetrics | null> {
  if (isNonBillingUsageEndpoint(session)) {
    return null;
  }

  if (usageMetrics) {
    return usageMetrics;
  }

  if (statusCode < 200 || statusCode >= 300) {
    return null;
  }

  const resolvedPricing = await session.getResolvedPricingByBillingSource(provider);
  if (!resolvedPricing?.priceData || !hasBillableInputCostPerRequest(resolvedPricing.priceData)) {
    return null;
  }

  // 成功响应可能没有 token usage（例如 OpenAI Images），但本地价格表仍可配置按次价格。
  // 这里用空 usage 只承载 input_cost_per_request，不新增按图、按 token 等语义。
  return {};
}

type FinalizeDeferredStreamingResult = {
  /**
   * “内部结算用”的状态码。
   *
   * 注意：这不会改变客户端实际收到的 HTTP 状态码（SSE 已经开始透传后无法回头改）。
   * 这里的目的仅是让内部统计/熔断/会话绑定把“假 200”按失败处理。
   */
  effectiveStatusCode: number;
  /**
   * 内部记录的错误原因（用于写入 DB/监控，帮助定位“假 200”问题）。
   */
  errorMessage: string | null;
  /**
   * 写入 DB 时用于归因的 providerId（优先使用 deferred meta 的 providerId）。
   *
   * 说明：对 SSE 来说，session.provider 可能在后续逻辑里被更新/覆盖；而 deferred meta 代表本次流真正对应的 provider。
   * 该字段用于保证 DB 的 providerId 与 providerChain/熔断归因一致。
   */
  providerIdForPersistence: number | null;
};

/**
 * 若本次 SSE 被标记为“延迟结算”，则在流结束后补齐成功/失败的最终判定。
 *
 * 触发条件
 * - Forwarder 收到 Response 且识别为 SSE 时，会在 session 上挂载 DeferredStreamingFinalization 元信息。
 * - ResponseHandler 在后台读取完整 SSE 内容后，调用本函数：
 *   - 如果内容看起来是上游错误 JSON（假 200），则：
 *     - 计入熔断器失败；
 *     - 不更新 session 智能绑定（避免把会话粘到坏 provider）；
 *     - 内部状态码改为“推断得到的 4xx/5xx”（未命中则回退 502），
 *       仅影响统计与后续重试选择，不影响本次客户端响应。
 *   - 如果流正常结束且未命中错误判定，则按成功结算并更新绑定/熔断/endpoint 成功率。
 *
 * @param streamEndedNormally - 必须是 reader 读到 done=true 的“自然结束”；超时/中断等异常结束由其它逻辑处理。
 * @param clientAborted - 标记是否为客户端主动中断（用于内部状态码映射，避免把中断记为 200 completed）
 * @param abortReason - 非自然结束时的原因码（用于内部记录/熔断归因；不会影响客户端响应）
 */
async function finalizeDeferredStreamingFinalizationIfNeeded(
  session: ProxySession,
  allContent: string,
  upstreamStatusCode: number,
  streamEndedNormally: boolean,
  clientAborted: boolean,
  abortReason?: string
): Promise<FinalizeDeferredStreamingResult> {
  const meta = consumeDeferredStreamingFinalization(session);
  const provider = session.provider;
  const clearSessionBinding = async () => {
    if (!session.sessionId) return;
    await SessionManager.clearSessionProvider(session.sessionId);
  };

  const providerIdForPersistence = meta?.providerId ?? provider?.id ?? null;

  // 仅在“上游 HTTP=200 且流自然结束”时做“假 200”检测：
  // - 非 200：HTTP 已经表明失败（无需额外启发式）
  // - 非自然结束：内容可能是部分流/截断，启发式会显著提高误判风险
  //
  // 此处返回 `{isError:false}` 仅表示“跳过检测”，最终仍会在下面按中断/超时视为失败结算。
  const shouldDetectFake200 = streamEndedNormally && upstreamStatusCode === 200;
  const detected = shouldDetectFake200
    ? detectUpstreamErrorFromSseOrJsonText(allContent)
    : ({ isError: false } as const);

  // “内部结算用”的状态码（不会改变客户端实际 HTTP 状态码）。
  // - 假 200：优先映射为“推断得到的 4xx/5xx”（未命中则回退 502），确保内部统计/熔断/会话绑定把它当作失败。
  // - 未自然结束：也应映射为失败（避免把中断/部分流误记为 200 completed）。
  let effectiveStatusCode: number;
  let errorMessage: string | null;
  let statusCodeInferred = false;
  let statusCodeInferenceMatcherId: string | undefined;
  if (detected.isError) {
    const inferred = inferUpstreamErrorStatusCodeFromText(allContent);
    if (inferred) {
      effectiveStatusCode = inferred.statusCode;
      statusCodeInferred = true;
      statusCodeInferenceMatcherId = inferred.matcherId;
    } else {
      effectiveStatusCode = 502;
    }
    errorMessage = detected.detail ? `${detected.code}: ${detected.detail}` : detected.code;
  } else if (!streamEndedNormally) {
    effectiveStatusCode = clientAborted ? 499 : 502;
    errorMessage = clientAborted ? "CLIENT_ABORTED" : (abortReason ?? "STREAM_ABORTED");
  } else {
    // streamEndedNormally=true
    effectiveStatusCode = upstreamStatusCode;

    if (upstreamStatusCode >= 400) {
      // 非200错误状态码：解析JSON错误响应
      const detected = detectUpstreamErrorFromSseOrJsonText(allContent);
      errorMessage = detected.isError ? detected.code : `HTTP ${upstreamStatusCode}`;
    } else {
      // 2xx 成功状态码
      errorMessage = null;
    }
  }

  const shouldClearSessionBindingOnFailure =
    !streamEndedNormally ||
    detected.isError ||
    (upstreamStatusCode >= 400 && errorMessage !== null);

  if ((!meta || !provider) && shouldClearSessionBindingOnFailure) {
    await clearSessionBinding();
  }

  // 未启用延迟结算 / provider 缺失：
  // - 只返回“内部状态码 + 错误原因”，由调用方写入统计；
  // - 不在这里更新熔断/绑定（meta 缺失意味着 Forwarder 没有启用延迟结算；provider 缺失意味着无法归因）。
  if (!meta || !provider) {
    return { effectiveStatusCode, errorMessage, providerIdForPersistence };
  }

  // meta 由 Forwarder 在“拿到 upstream Response 的那一刻”记录，代表真正产生本次流的 provider。
  // 即使 session.provider 在之后被其它逻辑意外修改（极端情况），我们仍以 meta 为准更新：
  // - provider/endpoint 熔断与统计
  // - session 智能绑定
  // 这样能避免把成功/失败记到错误的 provider 上。
  let providerForChain = provider;
  if (provider.id !== meta.providerId) {
    logger.warn("[ResponseHandler] Deferred streaming meta provider mismatch", {
      sessionId: session.sessionId ?? null,
      metaProviderId: meta.providerId,
      currentProviderId: provider.id,
      canonicalProviderId: meta.providerId,
    });

    // 尝试用 meta.providerId 找回正确的 Provider 对象，保证 providerChain 的审计数据一致
    try {
      const providers = await session.getProvidersSnapshot();
      const resolved = providers.find((p) => p.id === meta.providerId);
      if (resolved) {
        providerForChain = resolved;
      } else {
        logger.warn("[ResponseHandler] Deferred streaming meta provider not found in snapshot", {
          sessionId: session.sessionId ?? null,
          metaProviderId: meta.providerId,
          currentProviderId: provider.id,
        });
      }
    } catch (resolveError) {
      logger.warn("[ResponseHandler] Failed to resolve meta provider from snapshot", {
        sessionId: session.sessionId ?? null,
        metaProviderId: meta.providerId,
        currentProviderId: provider.id,
        error: resolveError,
      });
    }
  }

  // 未自然结束：不更新 session 绑定（避免把会话粘到不稳定 provider），但要避免把它误记为 200 completed。
  //
  // 同时，为了让故障转移/熔断能正确工作：
  // - 客户端主动中断：不计入熔断器（这通常不是供应商问题）
  // - 非客户端中断：计入 provider/endpoint 熔断失败（与 timeout 路径保持一致）
  if (!streamEndedNormally) {
    await clearSessionBinding();

    if (!clientAborted && session.getEndpointPolicy().allowCircuitBreakerAccounting) {
      try {
        // 动态导入：避免 proxy 模块与熔断器模块之间潜在的循环依赖。
        const { recordFailure } = await import("@/lib/circuit-breaker");
        await recordFailure(meta.providerId, new Error(errorMessage ?? "STREAM_ABORTED"));
      } catch (cbError) {
        logger.warn("[ResponseHandler] Failed to record streaming failure in circuit breaker", {
          providerId: meta.providerId,
          sessionId: session.sessionId ?? null,
          error: cbError,
        });
      }

      // NOTE: Do NOT call recordEndpointFailure here. Stream aborts are key-level
      // errors (auth, rate limit, bad key). The endpoint itself delivered HTTP 200
      // successfully. Only forwarder-level failures (timeout, network error) and
      // probe failures should penalize the endpoint circuit breaker.
    }

    session.addProviderToChain(providerForChain, {
      endpointId: meta.endpointId,
      endpointUrl: meta.endpointUrl,
      reason: "system_error",
      attemptNumber: meta.attemptNumber,
      statusCode: effectiveStatusCode,
      errorMessage: errorMessage ?? undefined,
    });

    return { effectiveStatusCode, errorMessage, providerIdForPersistence };
  }

  if (detected.isError) {
    await clearSessionBinding();

    logger.warn("[ResponseHandler] SSE completed but body indicates error (fake 200)", {
      providerId: meta.providerId,
      providerName: meta.providerName,
      upstreamStatusCode: meta.upstreamStatusCode,
      effectiveStatusCode,
      statusCodeInferred,
      statusCodeInferenceMatcherId: statusCodeInferenceMatcherId ?? null,
      code: detected.code,
      detail: detected.detail ?? null,
    });

    const chainReason = effectiveStatusCode === 404 ? "resource_not_found" : "retry_failed";

    // 计入熔断器：让后续请求能正确触发故障转移/熔断。
    //
    // 注意：404 语义在 forwarder 中属于 RESOURCE_NOT_FOUND，不计入熔断器（避免把“资源/模型不存在”当作供应商故障）。
    if (effectiveStatusCode !== 404 && session.getEndpointPolicy().allowCircuitBreakerAccounting) {
      try {
        // 动态导入：避免 proxy 模块与熔断器模块之间潜在的循环依赖。
        const { recordFailure } = await import("@/lib/circuit-breaker");
        await recordFailure(meta.providerId, new Error(detected.code));
      } catch (cbError) {
        logger.warn("[ResponseHandler] Failed to record fake-200 error in circuit breaker", {
          providerId: meta.providerId,
          sessionId: session.sessionId ?? null,
          error: cbError,
        });
      }
    }

    // NOTE: Do NOT call recordEndpointFailure here. Fake-200 errors are key-level
    // issues (invalid key, auth failure). The endpoint returned HTTP 200 successfully;
    // the error is in the response content, not endpoint connectivity.

    // 记录到决策链（用于日志展示与 DB 持久化）。
    // 注意：这里用 effectiveStatusCode（推断得到的 4xx/5xx，或回退 502）
    // 而不是 upstreamStatusCode（200），以便让内部链路明确显示这是一次失败
    // （否则会被误读为成功）。
    session.addProviderToChain(providerForChain, {
      endpointId: meta.endpointId,
      endpointUrl: meta.endpointUrl,
      reason: chainReason,
      attemptNumber: meta.attemptNumber,
      statusCode: effectiveStatusCode,
      statusCodeInferred,
      errorMessage: detected.detail ? `${detected.code}: ${detected.detail}` : detected.code,
    });

    return { effectiveStatusCode, errorMessage, providerIdForPersistence };
  }

  // ========== 非200状态码处理（流自然结束但HTTP状态码表示错误）==========
  if (upstreamStatusCode >= 400 && errorMessage !== null) {
    await clearSessionBinding();

    logger.warn("[ResponseHandler] SSE completed but HTTP status indicates error", {
      providerId: meta.providerId,
      providerName: meta.providerName,
      upstreamStatusCode,
      effectiveStatusCode,
      errorMessage,
    });

    const chainReason = effectiveStatusCode === 404 ? "resource_not_found" : "retry_failed";

    // 计入熔断器：让后续请求能正确触发故障转移/熔断。
    // 注意：与 forwarder 口径保持一致：404 不计入熔断器（资源不存在不是供应商故障）。
    if (effectiveStatusCode !== 404 && session.getEndpointPolicy().allowCircuitBreakerAccounting) {
      try {
        const { recordFailure } = await import("@/lib/circuit-breaker");
        await recordFailure(meta.providerId, new Error(errorMessage));
      } catch (cbError) {
        logger.warn("[ResponseHandler] Failed to record non-200 error in circuit breaker", {
          providerId: meta.providerId,
          sessionId: session.sessionId ?? null,
          error: cbError,
        });
      }
    }

    // NOTE: Do NOT call recordEndpointFailure here. Non-200 HTTP errors (401, 429,
    // etc.) are typically key/auth-level errors. The endpoint was reachable and
    // responded; only forwarder-level failures should penalize the endpoint breaker.

    // 记录到决策链
    session.addProviderToChain(providerForChain, {
      endpointId: meta.endpointId,
      endpointUrl: meta.endpointUrl,
      reason: chainReason,
      attemptNumber: meta.attemptNumber,
      statusCode: effectiveStatusCode,
      errorMessage: errorMessage,
    });

    return { effectiveStatusCode, errorMessage, providerIdForPersistence };
  }

  // ========== 真正成功（SSE 完整结束且未命中错误判定）==========
  if (meta.endpointId != null) {
    try {
      const { recordEndpointSuccess } = await import("@/lib/endpoint-circuit-breaker");
      await recordEndpointSuccess(meta.endpointId);
    } catch (endpointError) {
      logger.warn("[ResponseHandler] Failed to record endpoint success (stream finalized)", {
        endpointId: meta.endpointId,
        providerId: meta.providerId,
        error: endpointError,
      });
    }
  }

  try {
    const { recordSuccess } = await import("@/lib/circuit-breaker");
    await recordSuccess(meta.providerId);
  } catch (cbError) {
    logger.warn("[ResponseHandler] Failed to record streaming success in circuit breaker", {
      providerId: meta.providerId,
      error: cbError,
    });
  }

  // Hedge winner: commitWinner() already performed session binding and chain logging.
  // Skip duplicate operations to avoid double entries in the provider chain.
  if (!meta.isHedgeWinner) {
    // 成功后绑定 session 到供应商（智能绑定策略）
    if (session.sessionId) {
      const result = await SessionManager.updateSessionBindingSmart(
        session.sessionId,
        meta.providerId,
        meta.providerPriority,
        meta.isFirstAttempt,
        meta.isFailoverSuccess,
        session.authState?.key?.id ?? session.messageContext?.key?.id ?? null
      );

      if (result.updated) {
        logger.info("[ResponseHandler] Session binding updated (stream finalized)", {
          sessionId: session.sessionId,
          providerId: meta.providerId,
          providerName: meta.providerName,
          priority: meta.providerPriority,
          reason: result.reason,
          details: result.details,
          attemptNumber: meta.attemptNumber,
          totalProvidersAttempted: meta.totalProvidersAttempted,
        });
      } else {
        logger.debug("[ResponseHandler] Session binding not updated (stream finalized)", {
          sessionId: session.sessionId,
          providerId: meta.providerId,
          providerName: meta.providerName,
          priority: meta.providerPriority,
          reason: result.reason,
          details: result.details,
        });
      }

      // 统一更新两个数据源（确保监控数据一致）
      if (session.shouldTrackSessionObservability()) {
        void SessionManager.updateSessionProvider(session.sessionId, {
          providerId: meta.providerId,
          providerName: meta.providerName,
        }).catch((err) => {
          logger.error(
            "[ResponseHandler] Failed to update session provider info (stream finalized)",
            {
              error: err,
            }
          );
        });
      }
    }

    session.addProviderToChain(providerForChain, {
      endpointId: meta.endpointId,
      endpointUrl: meta.endpointUrl,
      reason: meta.isFirstAttempt ? "request_success" : "retry_success",
      attemptNumber: meta.attemptNumber,
      statusCode: meta.upstreamStatusCode,
    });
  }

  logger.info("[ResponseHandler] Streaming request finalized as success", {
    providerId: meta.providerId,
    providerName: meta.providerName,
    attemptNumber: meta.attemptNumber,
    totalProvidersAttempted: meta.totalProvidersAttempted,
    statusCode: meta.upstreamStatusCode,
  });

  return { effectiveStatusCode, errorMessage, providerIdForPersistence };
}

export class ProxyResponseHandler {
  static async dispatch(session: ProxySession, response: Response): Promise<Response> {
    const snapshotSession = session as ProxySession & {
      detailSnapshotResponseBeforeSource?: Response | null;
    };
    if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
      snapshotSession.detailSnapshotResponseBeforeSource = response.clone();
    }

    let fixedResponse = response;
    if (!session.getEndpointPolicy().bypassResponseRectifier) {
      try {
        fixedResponse = await ResponseFixer.process(session, response);
      } catch (error) {
        logger.error(
          "[ResponseHandler] ResponseFixer failed (getCachedSystemSettings/processNonStream)",
          {
            error: error instanceof Error ? error.message : String(error),
            sessionId: session.sessionId ?? null,
            messageRequestId: session.messageContext?.id ?? null,
            requestSequence: session.requestSequence ?? null,
          }
        );
        fixedResponse = response;
      }
    }

    const contentType = fixedResponse.headers.get("content-type") || "";
    const isSSE = contentType.includes("text/event-stream");

    if (!isSSE) {
      return await ProxyResponseHandler.handleNonStream(session, fixedResponse);
    }

    return await ProxyResponseHandler.handleStream(session, fixedResponse);
  }

  private static async handleNonStream(
    session: ProxySession,
    response: Response
  ): Promise<Response> {
    const messageContext = session.messageContext;
    const provider = session.provider;
    if (!provider) {
      discardBeforeResponseBodySnapshot(session);
      releaseSessionAgent(session);
      return response;
    }

    const responseForLog = response.clone();
    const statusCode = response.status;

    let finalResponse = response;
    const persistNonStreamAfterSnapshot = async (targetResponse: Response) => {
      if (!session.sessionId || !session.shouldPersistSessionDebugArtifacts()) {
        return;
      }

      const finalBody = await targetResponse.clone().text();
      const responseAfterSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
        session.sessionId,
        "after",
        {
          body: finalBody,
          headers: targetResponse.headers,
          meta: {
            upstreamUrl: null,
            statusCode: targetResponse.status,
          },
        },
        session.requestSequence
      );
      responseAfterSnapshotTask?.catch((err) => {
        logger.error("[ResponseHandler] Failed to store response after snapshot:", err);
      });
    };

    // --- GEMINI HANDLING ---
    if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
      // 判断是否需要透传（客户端和提供商格式都必须是 Gemini）
      const isGeminiPassthrough =
        (session.originalFormat === "gemini" || session.originalFormat === "gemini-cli") &&
        (provider.providerType === "gemini" || provider.providerType === "gemini-cli");

      if (isGeminiPassthrough) {
        logger.debug(
          "[ResponseHandler] Gemini non-stream passthrough (clone for stats, return original)",
          {
            originalFormat: session.originalFormat,
            providerType: provider.providerType,
            model: session.request.model,
            statusCode: response.status,
            reason: "Client receives untouched response, stats read from clone",
          }
        );

        const responseForStats = response.clone();
        const statusCode = response.status;

        const taskId = `non-stream-passthrough-${messageContext?.id || `unknown-${Date.now()}`}`;
        const statsPromise = (async () => {
          try {
            const responseText = await responseForStats.text();

            const sessionWithCleanup = session as typeof session & {
              clearResponseTimeout?: () => void;
            };
            if (sessionWithCleanup.clearResponseTimeout) {
              sessionWithCleanup.clearResponseTimeout();
            }

            // 存储响应体到 Redis（5分钟过期）
            if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
              const beforeBody = (await consumeBeforeResponseBodySnapshot(session)) ?? responseText;
              void SessionManager.storeSessionResponse(
                session.sessionId,
                responseText,
                session.requestSequence
              ).catch((err) => {
                logger.error("[ResponseHandler] Failed to store response:", err);
              });

              const responseBeforeSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
                session.sessionId,
                "before",
                { body: beforeBody },
                session.requestSequence
              );
              responseBeforeSnapshotTask?.catch((err) => {
                logger.error("[ResponseHandler] Failed to store response before snapshot:", err);
              });

              const responseAfterSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
                session.sessionId,
                "after",
                { body: responseText },
                session.requestSequence
              );
              responseAfterSnapshotTask?.catch((err) => {
                logger.error("[ResponseHandler] Failed to store response after snapshot:", err);
              });
            }

            // 非200状态码处理：解析错误响应并计入熔断器
            let errorMessageForFinalize: string | undefined;
            if (statusCode >= 400) {
              const detected = detectUpstreamErrorFromSseOrJsonText(responseText);
              errorMessageForFinalize = detected.isError ? detected.code : `HTTP ${statusCode}`;

              // 计入熔断器
              if (session.getEndpointPolicy().allowCircuitBreakerAccounting) {
                try {
                  const { recordFailure } = await import("@/lib/circuit-breaker");
                  await recordFailure(provider.id, new Error(errorMessageForFinalize));
                } catch (cbError) {
                  logger.warn(
                    "ResponseHandler: Failed to record non-200 error in circuit breaker (passthrough)",
                    {
                      providerId: provider.id,
                      error: cbError,
                    }
                  );
                }
              }

              // 记录到决策链
              session.addProviderToChain(provider, {
                reason: "retry_failed",
                attemptNumber: 1,
                statusCode: statusCode,
                errorMessage: errorMessageForFinalize,
              });
            }

            // 使用共享的统计处理方法
            const duration = Date.now() - session.startTime;
            const finalizedUsage = await finalizeRequestStats(
              session,
              responseText,
              statusCode,
              duration,
              errorMessageForFinalize,
              undefined,
              false // Gemini 非流式透传
            );

            emitLangfuseTrace(session, {
              responseHeaders: response.headers,
              responseText,
              usageMetrics: finalizedUsage,
              costUsd: undefined,
              statusCode,
              durationMs: duration,
              isStreaming: false,
              errorMessage: errorMessageForFinalize,
            });
          } catch (error) {
            if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
              await discardBeforeResponseBodySnapshot(session);
            }
            if (!isClientAbortError(error as Error)) {
              logger.error(
                "[ResponseHandler] Gemini non-stream passthrough stats task failed:",
                error
              );
            }
          } finally {
            releaseSessionAgent(session);
            AsyncTaskManager.cleanup(taskId);
          }
        })();

        AsyncTaskManager.register(taskId, statsPromise, "non-stream-passthrough-stats");
        statsPromise.catch((error) => {
          if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
            void discardBeforeResponseBodySnapshot(session);
          }
          logger.error(
            "[ResponseHandler] Gemini non-stream passthrough stats task uncaught error:",
            error
          );
        });

        if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
          const responseAfterMetaTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
            session.sessionId,
            "after",
            {
              headers: response.headers,
              meta: {
                upstreamUrl: null,
                statusCode: response.status,
              },
            },
            session.requestSequence
          );
          responseAfterMetaTask?.catch((err) => {
            logger.error("[ResponseHandler] Failed to store non-stream response after meta:", err);
          });
        }

        return response;
      } else {
        // ❌ 需要转换：客户端不是 Gemini 格式（如 OpenAI/Claude）
        try {
          const responseForTransform = response.clone();
          const responseText = await responseForTransform.text();
          const responseData = JSON.parse(responseText) as GeminiResponse;

          const transformed = GeminiAdapter.transformResponse(responseData, false);

          logger.debug(
            "[ResponseHandler] Transformed Gemini non-stream response to client format",
            {
              originalFormat: session.originalFormat,
              providerType: provider.providerType,
              model: session.request.model,
            }
          );

          // ⭐ 清理传输 headers（body 已从流转为 JSON 字符串）
          finalResponse = new Response(JSON.stringify(transformed), {
            status: response.status,
            statusText: response.statusText,
            headers: cleanResponseHeaders(response.headers),
          });
        } catch (error) {
          logger.error("[ResponseHandler] Failed to transform Gemini non-stream response:", error);
          finalResponse = response;
        }
      }
    }

    // 使用 AsyncTaskManager 管理后台处理任务
    const taskId = `non-stream-${messageContext?.id || `unknown-${Date.now()}`}`;
    const abortController = new AbortController();
    const cleanupClientAbortListener = bindClientAbortListener(session.clientAbortSignal, () => {
      AsyncTaskManager.cancel(taskId);
      abortController.abort();
    });

    const processingPromise = (async () => {
      const finalizeNonStreamAbort = async (): Promise<void> => {
        const finalizedStatusCode = session.clientAbortSignal?.aborted ? 499 : statusCode;
        if (messageContext) {
          const duration = Date.now() - session.startTime;
          await updateMessageRequestDuration(messageContext.id, duration);
          await updateMessageRequestDetails(messageContext.id, {
            statusCode: finalizedStatusCode,
            ttfbMs: session.ttfbMs ?? duration,
            providerChain: session.getProviderChain(),
            model: session.getCurrentModel() ?? undefined, // 更新重定向后的模型
            providerId: session.provider?.id, // 更新最终供应商ID（重试切换后）
            context1mApplied: session.getContext1mApplied(),
            swapCacheTtlApplied: session.provider?.swapCacheTtlBilling ?? false,
          });
          const tracker = ProxyStatusTracker.getInstance();
          tracker.endRequest(messageContext.user.id, messageContext.id);
        }

        if (session.sessionId) {
          await SessionManager.clearSessionProvider(session.sessionId);

          const sessionUsagePayload: SessionUsageUpdate = {
            status: finalizedStatusCode >= 200 && finalizedStatusCode < 300 ? "completed" : "error",
            statusCode: finalizedStatusCode,
          };

          if (session.shouldTrackSessionObservability()) {
            void SessionManager.updateSessionUsage(session.sessionId, sessionUsagePayload).catch(
              (error: unknown) => {
                logger.error("[ResponseHandler] Failed to update session usage:", error);
              }
            );
          }
        }
      };

      try {
        // 检查客户端是否断开
        if (session.clientAbortSignal?.aborted || abortController.signal.aborted) {
          logger.info("ResponseHandler: Non-stream task cancelled (client disconnected)", {
            taskId,
            providerId: provider.id,
          });
          try {
            await finalizeNonStreamAbort();
          } catch (finalizeError) {
            logger.error("ResponseHandler: Failed to finalize aborted non-stream response", {
              taskId,
              providerId: provider.id,
              finalizeError,
            });
          }
          return;
        }

        // ⭐ 非流式：读取完整响应体（会等待所有数据下载完成）
        const responseText = await responseForLog.text();

        // ⭐ 响应体读取完成：清除响应超时定时器
        const sessionWithCleanup = session as typeof session & {
          clearResponseTimeout?: () => void;
        };
        if (sessionWithCleanup.clearResponseTimeout) {
          sessionWithCleanup.clearResponseTimeout();
        }
        let usageMetrics: UsageMetrics | null = null;

        const usageResult = parseUsageFromResponseText(responseText, provider.providerType);
        usageMetrics = usageResult.usageMetrics;
        const actualServiceTier = parseServiceTierFromResponseText(responseText);
        const codexPriorityBillingDecision = await resolveCodexPriorityBillingDecision(
          session,
          actualServiceTier
        );
        if (!isNonBillingUsageEndpoint(session)) {
          ensureCodexServiceTierResultSpecialSetting(session, codexPriorityBillingDecision);
        }
        const priorityServiceTierApplied = codexPriorityBillingDecision?.effectivePriority ?? false;

        if (usageMetrics) {
          usageMetrics = normalizeUsageWithSwap(
            usageMetrics,
            session,
            provider.swapCacheTtlBilling
          );
        }

        // 关键：必须在 normalizeUsageWithSwap 之后再快照 billable 视图，
        // 否则 updateRequestCostFromUsage / trackCostToRedis 会用未归一化的旧值，
        // 导致缓存 TTL swap、bucket 归一化等场景下的账单与限流统计错位。
        const billableUsageMetrics = await resolveBillableUsageMetricsForCost(
          session,
          provider,
          usageMetrics,
          statusCode
        );

        if (billableUsageMetrics) {
          maybeSetCodexContext1m(session, provider, billableUsageMetrics.input_tokens);
        }

        // Codex: Extract prompt_cache_key and update session binding
        if (provider.providerType === "codex" && session.sessionId && provider.id) {
          try {
            const responseData = JSON.parse(responseText) as Record<string, unknown>;
            const promptCacheKey = SessionManager.extractCodexPromptCacheKey(responseData);
            if (promptCacheKey) {
              void SessionManager.updateSessionWithCodexCacheKey(
                session.sessionId,
                promptCacheKey,
                provider.id,
                session.authState?.key?.id ?? session.messageContext?.key?.id ?? null
              ).catch((err) => {
                logger.error("[ResponseHandler] Failed to update Codex session:", err);
              });
            }
          } catch (parseError) {
            logger.trace("[ResponseHandler] Failed to parse JSON for Codex session:", parseError);
          }
        }

        // 存储响应体到 Redis（5分钟过期）
        if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
          const beforeBody = (await consumeBeforeResponseBodySnapshot(session)) ?? responseText;
          void SessionManager.storeSessionResponse(
            session.sessionId,
            responseText,
            session.requestSequence
          ).catch((err) => {
            logger.error("[ResponseHandler] Failed to store response:", err);
          });

          const responseBeforeSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
            session.sessionId,
            "before",
            { body: beforeBody },
            session.requestSequence
          );
          responseBeforeSnapshotTask?.catch((err) => {
            logger.error("[ResponseHandler] Failed to store response before snapshot:", err);
          });
        }

        if (billableUsageMetrics && messageContext) {
          const costUpdateResult = await updateRequestCostFromUsage(
            messageContext.id,
            session,
            billableUsageMetrics,
            provider,
            provider.costMultiplier,
            session.getContext1mApplied(),
            priorityServiceTierApplied,
            session.getGroupCostMultiplier()
          );
          if (costUpdateResult.longContextPricingApplied) {
            ensureLongContextPricingAudit(session, costUpdateResult.longContextPricing);
          }

          // 追踪消费到 Redis（用于限流）
          await trackCostToRedis(
            session,
            billableUsageMetrics,
            priorityServiceTierApplied,
            costUpdateResult.resolvedPricing,
            costUpdateResult.longContextPricing
          );
        }

        // Calculate cost for session tracking (with multiplier) and Langfuse (raw)
        let costUsdStr: string | undefined;
        let rawCostUsdStr: string | undefined;
        let costBreakdown: CostBreakdown | undefined;
        if (billableUsageMetrics) {
          try {
            if (session.request.model) {
              const resolvedPricing = await session.getResolvedPricingByBillingSource(provider);
              if (resolvedPricing) {
                ensurePricingResolutionSpecialSetting(session, resolvedPricing);
                const longContextPricing =
                  matchLongContextPricing(billableUsageMetrics, resolvedPricing.priceData)
                    ?.pricing ?? null;
                const cost = calculateRequestCost(
                  billableUsageMetrics,
                  resolvedPricing.priceData,
                  buildCostCalculationOptions(
                    provider.costMultiplier,
                    session.getContext1mApplied(),
                    priorityServiceTierApplied,
                    longContextPricing,
                    session.getGroupCostMultiplier()
                  )
                );
                if (cost.gt(0)) {
                  costUsdStr = cost.toString();
                }
                // Raw cost without multiplier for Langfuse
                if (provider.costMultiplier !== 1 || session.getGroupCostMultiplier() !== 1) {
                  const rawCost = calculateRequestCost(
                    billableUsageMetrics,
                    resolvedPricing.priceData,
                    buildCostCalculationOptions(
                      1.0,
                      session.getContext1mApplied(),
                      priorityServiceTierApplied,
                      longContextPricing
                    )
                  );
                  if (rawCost.gt(0)) {
                    rawCostUsdStr = rawCost.toString();
                  }
                } else {
                  rawCostUsdStr = costUsdStr;
                }
                // Cost breakdown for Langfuse (raw, no multiplier)
                try {
                  costBreakdown = calculateRequestCostBreakdown(
                    billableUsageMetrics,
                    resolvedPricing.priceData,
                    {
                      context1mApplied: session.getContext1mApplied(),
                      priorityServiceTierApplied,
                      longContextPricing,
                    }
                  );
                } catch {
                  /* non-critical */
                }
              }
            }
          } catch (error) {
            logger.error("[ResponseHandler] Failed to calculate session cost, skipping", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // 更新 session 使用量到 Redis（用于实时监控）
        if (
          session.sessionId &&
          (usageMetrics || costUsdStr !== undefined) &&
          session.shouldTrackSessionObservability()
        ) {
          void SessionManager.updateSessionUsage(session.sessionId, {
            inputTokens: usageMetrics?.input_tokens,
            outputTokens: usageMetrics?.output_tokens,
            cacheCreationInputTokens: usageMetrics?.cache_creation_input_tokens,
            cacheReadInputTokens: usageMetrics?.cache_read_input_tokens,
            costUsd: costUsdStr,
            status: statusCode >= 200 && statusCode < 300 ? "completed" : "error",
            statusCode: statusCode,
          }).catch((error: unknown) => {
            logger.error("[ResponseHandler] Failed to update session usage:", error);
          });
        }

        // 非200状态码处理：解析错误响应并计入熔断器
        if (statusCode >= 400) {
          const detected = detectUpstreamErrorFromSseOrJsonText(responseText);
          const errorMessageForDb = detected.isError ? detected.code : `HTTP ${statusCode}`;

          // 计入熔断器
          if (session.getEndpointPolicy().allowCircuitBreakerAccounting) {
            try {
              const { recordFailure } = await import("@/lib/circuit-breaker");
              await recordFailure(provider.id, new Error(errorMessageForDb));
            } catch (cbError) {
              logger.warn("ResponseHandler: Failed to record non-200 error in circuit breaker", {
                providerId: provider.id,
                error: cbError,
              });
            }
          }

          // 记录到决策链
          session.addProviderToChain(provider, {
            reason: "retry_failed",
            attemptNumber: 1,
            statusCode: statusCode,
            errorMessage: errorMessageForDb,
          });
        }

        if (messageContext) {
          const duration = Date.now() - session.startTime;
          await updateMessageRequestDuration(messageContext.id, duration);

          // 保存扩展信息（status code, tokens, provider chain）
          await updateMessageRequestDetails(messageContext.id, {
            statusCode: statusCode,
            inputTokens: usageMetrics?.input_tokens,
            outputTokens: usageMetrics?.output_tokens,
            ttfbMs: session.ttfbMs ?? duration,
            cacheCreationInputTokens: usageMetrics?.cache_creation_input_tokens,
            cacheReadInputTokens: usageMetrics?.cache_read_input_tokens,
            cacheCreation5mInputTokens: usageMetrics?.cache_creation_5m_input_tokens,
            cacheCreation1hInputTokens: usageMetrics?.cache_creation_1h_input_tokens,
            cacheTtlApplied: usageMetrics?.cache_ttl ?? null,
            providerChain: session.getProviderChain(),
            model: session.getCurrentModel() ?? undefined, // 更新重定向后的模型
            actualResponseModel: extractActualResponseModelForProvider(
              provider.providerType,
              false,
              responseText
            ),
            providerId: session.provider?.id, // 更新最终供应商ID（重试切换后）
            context1mApplied: session.getContext1mApplied(),
            swapCacheTtlApplied: session.provider?.swapCacheTtlBilling ?? false,
            specialSettings: session.getSpecialSettings() ?? undefined,
          });

          // 记录请求结束
          const tracker = ProxyStatusTracker.getInstance();
          tracker.endRequest(messageContext.user.id, messageContext.id);
        }

        logger.debug("ResponseHandler: Non-stream response processed", {
          taskId,
          providerId: provider.id,
          providerName: provider.name,
          statusCode,
        });

        emitLangfuseTrace(session, {
          responseHeaders: response.headers,
          responseText,
          usageMetrics,
          costUsd: rawCostUsdStr,
          costBreakdown,
          statusCode,
          durationMs: Date.now() - session.startTime,
          isStreaming: false,
        });
      } catch (error) {
        if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
          await discardBeforeResponseBodySnapshot(session);
        }
        // 检测 AbortError 的来源：响应超时 vs 客户端中断
        const err = error as Error;
        if (isClientAbortError(err)) {
          // 获取 responseController 引用（由 forwarder.ts 传递）
          const sessionWithController = session as typeof session & {
            responseController?: AbortController;
          };

          // 区分超时和客户端中断
          const isResponseTimeout =
            sessionWithController.responseController?.signal.aborted &&
            !session.clientAbortSignal?.aborted;

          if (isResponseTimeout) {
            // ⚠️ 响应超时：计入熔断器并记录错误日志
            logger.error("ResponseHandler: Response timeout during non-stream body read", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              errorName: err.name,
            });

            // 计入熔断器（动态导入避免循环依赖）
            if (session.getEndpointPolicy().allowCircuitBreakerAccounting) {
              try {
                const { recordFailure } = await import("@/lib/circuit-breaker");
                await recordFailure(provider.id, err);
                logger.debug("ResponseHandler: Response timeout recorded in circuit breaker", {
                  providerId: provider.id,
                });
              } catch (cbError) {
                logger.warn("ResponseHandler: Failed to record timeout in circuit breaker", {
                  providerId: provider.id,
                  error: cbError,
                });
              }
            }

            // 注意：无法重试，因为客户端已收到 HTTP 200
            // 错误已记录，熔断器已更新，不抛出异常（避免影响后台任务）

            // 更新数据库记录（避免 orphan record）
            await persistRequestFailure({
              session,
              messageContext,
              statusCode: statusCode && statusCode >= 400 ? statusCode : 502,
              error: err,
              taskId,
              phase: "non-stream",
            });

            // 执行清理逻辑
            try {
              await finalizeNonStreamAbort();
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize aborted non-stream response", {
                taskId,
                providerId: provider.id,
                finalizeError,
              });
            }
          } else {
            // 客户端主动中断：正常日志，不抛出错误
            logger.warn("ResponseHandler: Non-stream processing aborted by client", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              errorName: err.name,
              reason:
                err.name === "ResponseAborted"
                  ? "Response transmission interrupted"
                  : "Client disconnected",
            });
            try {
              await finalizeNonStreamAbort();
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize aborted non-stream response", {
                taskId,
                providerId: provider.id,
                finalizeError,
              });
            }
          }
        } else {
          logger.error("Failed to handle non-stream log:", error);

          // 更新数据库记录（避免 orphan record）
          await persistRequestFailure({
            session,
            messageContext,
            statusCode: statusCode && statusCode >= 400 ? statusCode : 500,
            error,
            taskId,
            phase: "non-stream",
          });
        }
      } finally {
        cleanupClientAbortListener();
        releaseSessionAgent(session);
        AsyncTaskManager.cleanup(taskId);
      }
    })();

    // 注册任务并添加全局错误捕获
    AsyncTaskManager.register(taskId, processingPromise, "non-stream-processing");
    processingPromise.catch(async (error) => {
      logger.error("ResponseHandler: Uncaught error in non-stream processing", {
        taskId,
        error,
      });

      // 更新数据库记录（避免 orphan record）
      await persistRequestFailure({
        session,
        messageContext,
        statusCode: statusCode && statusCode >= 400 ? statusCode : 500,
        error,
        taskId,
        phase: "non-stream",
      });
    });

    void persistNonStreamAfterSnapshot(finalResponse).catch((error) => {
      logger.error("[ResponseHandler] Failed to persist non-stream after snapshot", { error });
    });
    return finalResponse;
  }

  private static async handleStream(session: ProxySession, response: Response): Promise<Response> {
    const messageContext = session.messageContext;
    const provider = session.provider;

    if (!messageContext || !provider || !response.body) {
      discardBeforeResponseBodySnapshot(session);
      releaseSessionAgent(session);
      return response;
    }

    let processedStream: ReadableStream<Uint8Array> = response.body;

    // --- GEMINI STREAM HANDLING ---
    if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
      // 判断是否需要透传（客户端和提供商格式都必须是 Gemini）
      const isGeminiPassthrough =
        (session.originalFormat === "gemini" || session.originalFormat === "gemini-cli") &&
        (provider.providerType === "gemini" || provider.providerType === "gemini-cli");

      if (isGeminiPassthrough) {
        // 完全透传：clone 用于后台统计，返回原始 response
        logger.debug(
          "[ResponseHandler] Gemini stream passthrough (clone for stats, return original)",
          {
            originalFormat: session.originalFormat,
            providerType: provider.providerType,
            model: session.request.model,
            statusCode: response.status,
            reason: "Client receives untouched response, stats read from clone",
          }
        );

        // 注意：不要在“仅收到响应头”时清除首字节超时。
        // 背景：部分上游可能会快速返回 200 + SSE headers，但随后长时间不发送任何 body 数据。
        // 若在 headers 阶段就 clearResponseTimeout，会导致首字节超时失效，客户端与服务端都会表现为一直“请求中”。
        // 透传场景下，我们在后台 stats 读取到第一块数据时再清除超时（与非透传路径口径一致）。

        const responseForStats = response.clone();
        const statusCode = response.status;

        const taskId = `stream-passthrough-${messageContext.id}`;
        const statsPromise = (async () => {
          const sessionWithCleanup = session as typeof session & {
            clearResponseTimeout?: () => void;
          };
          const sessionWithController = session as typeof session & {
            responseController?: AbortController;
          };

          let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
          // 保护：避免透传 stats 任务把超大响应体无界缓存在内存中（DoS/OOM 风险）
          // 说明：用于统计/结算的内容采用“头部 + 尾部窗口”：
          // - 头部保留前 MAX_STATS_HEAD_BYTES（便于解析可能前置的 metadata）
          // - 尾部保留最近 MAX_STATS_TAIL_BYTES（便于解析结尾 usage/假 200 等）
          // - 中间部分会被丢弃（wasTruncated=true），统计将退化为 best-effort
          const MAX_STATS_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB
          const MAX_STATS_HEAD_BYTES = 1024 * 1024; // 1MB
          const MAX_STATS_TAIL_BYTES = MAX_STATS_BUFFER_BYTES - MAX_STATS_HEAD_BYTES;
          const MAX_STATS_TAIL_CHUNKS = 8192;

          const headChunks: string[] = [];
          let headBufferedBytes = 0;

          const tailChunks: string[] = [];
          const tailChunkBytes: number[] = [];
          let tailHead = 0;
          let tailBufferedBytes = 0;
          let wasTruncated = false;
          let inTailMode = false;

          const joinTailChunks = (): string => {
            if (tailHead <= 0) return tailChunks.join("");
            return tailChunks.slice(tailHead).join("");
          };

          const joinChunks = (): string => {
            const headText = headChunks.join("");
            if (!inTailMode) {
              return headText;
            }

            const tailText = joinTailChunks();

            // 用 SSE comment 标记被截断的中间段；parseSSEData 会忽略 ":" 开头的行
            if (wasTruncated) {
              // 插入空行强制 flush event，避免“头+尾”拼接后跨 event 误拼接数据行
              return `${headText}\n\n: [cch_truncated]\n\n${tailText}`;
            }

            return `${headText}${tailText}`;
          };

          const pushChunk = (text: string, bytes: number) => {
            if (!text) return;

            const pushToTail = (tailText: string, tailBytes: number) => {
              if (!tailText) return;

              tailChunks.push(tailText);
              tailChunkBytes.push(tailBytes);
              tailBufferedBytes += tailBytes;

              // 仅保留尾部窗口，避免内存无界增长
              while (tailBufferedBytes > MAX_STATS_TAIL_BYTES && tailHead < tailChunkBytes.length) {
                tailBufferedBytes -= tailChunkBytes[tailHead] ?? 0;
                tailChunks[tailHead] = "";
                tailChunkBytes[tailHead] = 0;
                tailHead += 1;
                wasTruncated = true;
              }

              // 定期压缩数组，避免 head 指针过大导致 slice/join 性能退化
              if (tailHead > 4096) {
                tailChunks.splice(0, tailHead);
                tailChunkBytes.splice(0, tailHead);
                tailHead = 0;
              }

              // 防御：限制 chunk 数量，避免大量超小 chunk 导致对象/数组膨胀（即使总字节数已受限）
              const keptCount = tailChunks.length - tailHead;
              if (keptCount > MAX_STATS_TAIL_CHUNKS) {
                const joined = joinTailChunks();
                tailChunks.length = 0;
                tailChunkBytes.length = 0;
                tailHead = 0;
                tailChunks.push(joined);
                tailChunkBytes.push(tailBufferedBytes);
              }
            };

            // 优先填充 head；超过 head 上限后切到 tail（但不代表一定发生截断，只有 tail 溢出才算截断）
            if (!inTailMode && headBufferedBytes < MAX_STATS_HEAD_BYTES) {
              const remainingHeadBytes = MAX_STATS_HEAD_BYTES - headBufferedBytes;
              if (remainingHeadBytes > 0 && bytes > remainingHeadBytes) {
                const headPart = text.substring(0, remainingHeadBytes);
                const tailPart = text.substring(remainingHeadBytes);

                pushChunk(headPart, remainingHeadBytes);

                inTailMode = true;
                pushToTail(tailPart, bytes - remainingHeadBytes);
              } else {
                headChunks.push(text);
                headBufferedBytes += bytes;
              }
            } else {
              pushToTail(text, bytes);
            }
          };
          const decoder = new TextDecoder();
          let isFirstChunk = true;
          let streamEndedNormally = false;
          let responseTimeoutCleared = false;
          let abortReason: string | undefined;

          // 静默期 Watchdog：透传也需要支持中途卡住（无新数据推送）
          const idleTimeoutMs =
            provider.streamingIdleTimeoutMs > 0 ? provider.streamingIdleTimeoutMs : Infinity;
          let idleTimeoutId: NodeJS.Timeout | null = null;
          const clearIdleTimer = () => {
            if (idleTimeoutId) {
              clearTimeout(idleTimeoutId);
              idleTimeoutId = null;
            }
          };
          const startIdleTimer = () => {
            if (idleTimeoutMs === Infinity) return;
            clearIdleTimer();
            idleTimeoutId = setTimeout(() => {
              abortReason = "STREAM_IDLE_TIMEOUT";
              logger.warn("[ResponseHandler] Gemini passthrough streaming idle timeout triggered", {
                taskId,
                providerId: provider.id,
                providerName: provider.name,
                idleTimeoutMs,
                chunksCollected: headChunks.length + Math.max(0, tailChunks.length - tailHead),
                headBufferedBytes,
                tailBufferedBytes,
                bufferedBytes: headBufferedBytes + tailBufferedBytes,
                wasTruncated,
              });
              // 终止上游连接：让透传到客户端的连接也尽快结束，避免永久悬挂占用资源
              try {
                sessionWithController.responseController?.abort(new Error("streaming_idle"));
              } catch {
                // ignore
              }
            }, idleTimeoutMs);
          };

          const clearResponseTimeoutOnce = (firstChunkSize?: number) => {
            if (responseTimeoutCleared) return;
            if (!sessionWithCleanup.clearResponseTimeout) return;
            sessionWithCleanup.clearResponseTimeout();
            responseTimeoutCleared = true;
            if (firstChunkSize != null) {
              logger.debug(
                "[ResponseHandler] Gemini passthrough: First chunk received, response timeout cleared",
                {
                  taskId,
                  providerId: provider.id,
                  providerName: provider.name,
                  firstChunkSize,
                }
              );
            }
          };

          const flushAndJoin = (): string => {
            const flushed = decoder.decode();
            if (flushed) pushChunk(flushed, 0);
            return joinChunks();
          };

          try {
            const body = responseForStats.body;
            if (!body) return;
            reader = body.getReader();

            // 注意：即使 STORE_SESSION_RESPONSE_BODY=false（不写入 Redis），这里也会在内存中累积完整流内容：
            // - 用于解析 usage/cost 与内部结算（例如“假 200”检测）
            // 因此该开关仅影响“是否持久化”，不用于控制流式内存占用。
            while (true) {
              if (session.clientAbortSignal?.aborted) break;

              const { done, value } = await reader.read();
              if (done) {
                const wasResponseControllerAborted =
                  sessionWithController.responseController?.signal.aborted ?? false;
                const clientAborted = session.clientAbortSignal?.aborted ?? false;

                // abort -> nodeStreamToWebStreamSafe 可能会把错误吞掉并 close()，导致 done=true；
                // 这里必须结合 abort signal 判断是否为“自然结束”。
                if (wasResponseControllerAborted || clientAborted) {
                  streamEndedNormally = false;
                  if (!abortReason) {
                    abortReason = clientAborted ? "CLIENT_ABORTED" : "STREAM_RESPONSE_TIMEOUT";
                  }
                } else {
                  streamEndedNormally = true;
                }
                break;
              }

              const chunkSize = value?.byteLength ?? 0;
              if (value && chunkSize > 0) {
                if (isFirstChunk) {
                  isFirstChunk = false;
                  session.recordTtfb();
                  clearResponseTimeoutOnce(chunkSize);
                }

                // 尽量填满 head：边界 chunk 可能跨过 head 上限，按 byte 切分以避免 head 少于 1MB
                if (!inTailMode && headBufferedBytes < MAX_STATS_HEAD_BYTES) {
                  const remainingHeadBytes = MAX_STATS_HEAD_BYTES - headBufferedBytes;
                  if (remainingHeadBytes > 0 && chunkSize > remainingHeadBytes) {
                    const headPart = value.subarray(0, remainingHeadBytes);
                    const tailPart = value.subarray(remainingHeadBytes);

                    const headText = decoder.decode(headPart, { stream: true });
                    pushChunk(headText, remainingHeadBytes);

                    inTailMode = true;
                    const tailText = decoder.decode(tailPart, { stream: true });
                    pushChunk(tailText, chunkSize - remainingHeadBytes);
                  } else {
                    pushChunk(decoder.decode(value, { stream: true }), chunkSize);
                  }
                } else {
                  pushChunk(decoder.decode(value, { stream: true }), chunkSize);
                }
              }

              // 首块数据到达后才启动 idle timer（避免与首字节超时职责重叠）
              if (!isFirstChunk) {
                startIdleTimer();
              }
            }

            clearIdleTimer();
            const allContent = flushAndJoin();
            const clientAborted = session.clientAbortSignal?.aborted ?? false;

            // 存储响应体到 Redis（5分钟过期）
            if (
              session.sessionId &&
              !wasTruncated &&
              session.shouldPersistSessionDebugArtifacts()
            ) {
              void SessionManager.storeSessionResponse(
                session.sessionId,
                allContent,
                session.requestSequence
              ).catch((err) => {
                logger.error("[ResponseHandler] Failed to store stream passthrough response:", err);
              });

              const responseBeforeSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
                session.sessionId,
                "before",
                { body: allContent },
                session.requestSequence
              );
              responseBeforeSnapshotTask?.catch((err) => {
                logger.error("[ResponseHandler] Failed to store response before snapshot:", err);
              });

              const responseAfterSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
                session.sessionId,
                "after",
                { body: allContent },
                session.requestSequence
              );
              responseAfterSnapshotTask?.catch((err) => {
                logger.error("[ResponseHandler] Failed to store response after snapshot:", err);
              });
            } else if (session.sessionId && wasTruncated) {
              logger.warn("[ResponseHandler] Skip storing passthrough response: body too large", {
                taskId,
                providerId: provider.id,
                providerName: provider.name,
                maxBytes: MAX_STATS_BUFFER_BYTES,
              });
            }

            // 使用共享的统计处理方法
            const duration = Date.now() - session.startTime;
            const finalized = await finalizeDeferredStreamingFinalizationIfNeeded(
              session,
              allContent,
              statusCode,
              streamEndedNormally,
              clientAborted,
              abortReason
            );
            const finalizedUsage = await finalizeRequestStats(
              session,
              allContent,
              finalized.effectiveStatusCode,
              duration,
              finalized.errorMessage ?? undefined,
              finalized.providerIdForPersistence ?? undefined,
              true // Gemini 流式透传(NDJSON 无 data:/event: 前缀,必须显式告知)
            );

            emitLangfuseTrace(session, {
              responseHeaders: response.headers,
              responseText: allContent,
              usageMetrics: finalizedUsage,
              costUsd: undefined,
              statusCode: finalized.effectiveStatusCode,
              durationMs: duration,
              isStreaming: true,
              errorMessage: finalized.errorMessage ?? undefined,
            });
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            const clientAborted = session.clientAbortSignal?.aborted ?? false;
            const isResponseControllerAborted =
              sessionWithController.responseController?.signal.aborted ?? false;
            const isIdleTimeout = !!err.message?.includes("streaming_idle");

            abortReason =
              abortReason ??
              (clientAborted
                ? "CLIENT_ABORTED"
                : isIdleTimeout
                  ? "STREAM_IDLE_TIMEOUT"
                  : isResponseControllerAborted
                    ? "STREAM_RESPONSE_TIMEOUT"
                    : "STREAM_PROCESSING_ERROR");

            // 透传的 stats 任务失败时，必须尽量落库并结束追踪，避免请求长期停留在“requesting”
            logger.error("[ResponseHandler] Gemini passthrough stats task failed", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              clientAborted,
              isResponseControllerAborted,
              isIdleTimeout,
              abortReason,
              errorName: err.name,
              errorMessage: err.message || "(empty message)",
            });

            try {
              clearIdleTimer();
              const allContent = flushAndJoin();
              const duration = Date.now() - session.startTime;

              const finalized = await finalizeDeferredStreamingFinalizationIfNeeded(
                session,
                allContent,
                statusCode,
                false,
                clientAborted,
                abortReason
              );

              await finalizeRequestStats(
                session,
                allContent,
                finalized.effectiveStatusCode,
                duration,
                finalized.errorMessage ?? abortReason,
                finalized.providerIdForPersistence ?? undefined,
                true // 流式透传错误兜底也是流式上下文
              );
            } catch (finalizeError) {
              await persistRequestFailure({
                session,
                messageContext,
                statusCode: statusCode && statusCode >= 400 ? statusCode : 502,
                error: finalizeError,
                taskId,
                phase: "stream",
              });
            }
          } finally {
            clearIdleTimer();
            // 兜底：在流结束/中断后清理首字节超时，避免定时器泄漏
            // 注意：不应在流仍可能继续时清理（否则会让首字节超时失效）
            try {
              const wasResponseControllerAborted =
                sessionWithController.responseController?.signal.aborted ?? false;
              const clientAborted = session.clientAbortSignal?.aborted ?? false;
              const shouldClearTimeout =
                responseTimeoutCleared ||
                streamEndedNormally ||
                wasResponseControllerAborted ||
                clientAborted;
              if (shouldClearTimeout) {
                clearResponseTimeoutOnce();
              }
            } catch (e) {
              logger.warn(
                "[ResponseHandler] Gemini passthrough: Failed to clear response timeout",
                {
                  taskId,
                  providerId: provider.id,
                  providerName: provider.name,
                  error: e instanceof Error ? e.message : String(e),
                }
              );
            }
            try {
              // 取消 tee 分支，避免 stats 任务提前退出时 backpressure 影响客户端透传
              const cancelPromise = reader?.cancel();
              if (cancelPromise) {
                cancelPromise.catch((err) => {
                  logger.warn(
                    "[ResponseHandler] Gemini passthrough: Failed to cancel stats reader",
                    {
                      taskId,
                      providerId: provider.id,
                      providerName: provider.name,
                      error: err instanceof Error ? err.message : String(err),
                    }
                  );
                });
              }
            } catch (e) {
              logger.warn("[ResponseHandler] Gemini passthrough: Failed to cancel stats reader", {
                taskId,
                providerId: provider.id,
                providerName: provider.name,
                error: e instanceof Error ? e.message : String(e),
              });
            }
            try {
              // 取消 reader lock
              reader?.releaseLock();
            } catch (e) {
              logger.warn("[ResponseHandler] Gemini passthrough: Failed to release reader lock", {
                taskId,
                providerId: provider.id,
                providerName: provider.name,
                error: e instanceof Error ? e.message : String(e),
              });
            }
            releaseSessionAgent(session);
            AsyncTaskManager.cleanup(taskId);
          }
        })();

        AsyncTaskManager.register(taskId, statsPromise, "stream-passthrough-stats");
        statsPromise.catch((error) => {
          if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
            void discardBeforeResponseBodySnapshot(session);
          }
          logger.error("[ResponseHandler] Gemini passthrough stats task uncaught error:", error);
        });

        if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
          const responseAfterMetaTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
            session.sessionId,
            "after",
            {
              headers: response.headers,
              meta: {
                upstreamUrl: null,
                statusCode: response.status,
              },
            },
            session.requestSequence
          );
          responseAfterMetaTask?.catch((err) => {
            logger.error("[ResponseHandler] Failed to store stream response after meta:", err);
          });
        }

        discardBeforeResponseBodySnapshot(session);
        return response;
      } else {
        // ❌ 需要转换：客户端不是 Gemini 格式（如 OpenAI/Claude）
        logger.debug("[ResponseHandler] Transforming Gemini stream to client format", {
          originalFormat: session.originalFormat,
          providerType: provider.providerType,
          model: session.request.model,
        });

        let buffer = "";
        const transformStream = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const decoder = new TextDecoder();
            const text = decoder.decode(chunk, { stream: true });
            buffer += text;

            const lines = buffer.split("\n");
            // Keep the last line in buffer as it might be incomplete
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (trimmedLine.startsWith("data:")) {
                const jsonStr = trimmedLine.slice(5).trim();
                if (!jsonStr) continue;
                try {
                  const geminiResponse = JSON.parse(jsonStr) as GeminiResponse;
                  const openAIChunk = GeminiAdapter.transformResponse(geminiResponse, true);
                  const output = `data: ${JSON.stringify(openAIChunk)}\n\n`;
                  controller.enqueue(new TextEncoder().encode(output));
                } catch {
                  // Ignore parse errors
                }
              }
            }
          },
          flush(controller) {
            if (buffer.trim().startsWith("data:")) {
              try {
                const jsonStr = buffer.trim().slice(5).trim();
                const geminiResponse = JSON.parse(jsonStr) as GeminiResponse;
                const openAIChunk = GeminiAdapter.transformResponse(geminiResponse, true);
                const output = `data: ${JSON.stringify(openAIChunk)}\n\n`;
                controller.enqueue(new TextEncoder().encode(output));
              } catch {}
            }
          },
        });
        processedStream = response.body.pipeThrough(transformStream);
      }
    }

    // ⭐ 使用 TransformStream 包装流，以便在 idle timeout 时能关闭客户端流
    // 这解决了 tee() 后 internalStream abort 不影响 clientStream 的问题
    let streamController: TransformStreamDefaultController<Uint8Array> | null = null;
    const controllableStream = processedStream.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        start(controller) {
          streamController = controller; // 保存 controller 引用
        },
        transform(chunk, controller) {
          controller.enqueue(chunk); // 透传数据
        },
      })
    );

    const [clientStream, internalStream] = controllableStream.tee();
    const statusCode = response.status;

    // 使用 AsyncTaskManager 管理后台处理任务
    const taskId = `stream-${messageContext?.id || `unknown-${Date.now()}`}`;
    const abortController = new AbortController();

    // ⭐ 提升 idleTimeoutId 到外部作用域，以便客户端断开时能清除
    let idleTimeoutId: NodeJS.Timeout | null = null;
    const cleanupClientAbortListener = bindClientAbortListener(session.clientAbortSignal, () => {
      logger.debug("ResponseHandler: Client disconnected, cleaning up", {
        taskId,
        providerId: provider.id,
        messageId: messageContext.id,
      });

      // 客户端断开时清除 idle timeout，避免任务已取消后仍误触发。
      if (idleTimeoutId) {
        clearTimeout(idleTimeoutId);
        idleTimeoutId = null;
        logger.debug("ResponseHandler: Idle timeout cleared due to client disconnect", {
          taskId,
          providerId: provider.id,
        });
      }

      AsyncTaskManager.cancel(taskId);
      abortController.abort();
    });

    const processingPromise = (async () => {
      const reader = internalStream.getReader();
      const decoder = new TextDecoder();
      // 注意：即使 STORE_SESSION_RESPONSE_BODY=false（不写入 Redis），这里也会在内存中累积完整流内容：
      // - 用于解析 usage/cost 与内部结算（例如“假 200”检测）
      // 因此该开关仅影响“是否持久化”，不用于控制流式内存占用。
      const chunks: string[] = [];
      let usageForCost: UsageMetrics | null = null;
      let isFirstChunk = true; // ⭐ 标记是否为第一块数据

      // ⭐ 静默期 Watchdog：监控流式请求中途卡住（无新数据推送）
      const idleTimeoutMs =
        provider.streamingIdleTimeoutMs > 0 ? provider.streamingIdleTimeoutMs : Infinity;
      const startIdleTimer = () => {
        if (idleTimeoutMs === Infinity) return; // 禁用时跳过
        clearIdleTimer(); // 清除旧的
        idleTimeoutId = setTimeout(() => {
          logger.warn("ResponseHandler: Streaming idle timeout triggered", {
            taskId,
            providerId: provider.id,
            idleTimeoutMs,
            chunksCollected: chunks.length,
          });

          // ⭐ 1. 关闭客户端流（让客户端收到连接关闭通知，避免悬挂）
          try {
            if (streamController) {
              streamController.error(new Error("Streaming idle timeout"));
              logger.debug("ResponseHandler: Client stream closed due to idle timeout", {
                taskId,
                providerId: provider.id,
              });
            }
          } catch (e) {
            logger.warn("ResponseHandler: Failed to close client stream", {
              taskId,
              providerId: provider.id,
              error: e,
            });
          }

          // ⭐ 2. 终止上游连接（避免资源泄漏）
          try {
            const sessionWithController = session as typeof session & {
              responseController?: AbortController;
            };
            if (sessionWithController.responseController) {
              sessionWithController.responseController.abort(new Error("streaming_idle"));
              logger.debug("ResponseHandler: Upstream connection aborted due to idle timeout", {
                taskId,
                providerId: provider.id,
              });
            }
          } catch (e) {
            logger.warn("ResponseHandler: Failed to abort upstream connection", {
              taskId,
              providerId: provider.id,
              error: e,
            });
          }

          // ⭐ 3. 终止后台读取任务
          abortController.abort(new Error("streaming_idle"));
        }, idleTimeoutMs);
      };
      const clearIdleTimer = () => {
        if (idleTimeoutId) {
          clearTimeout(idleTimeoutId);
          idleTimeoutId = null;
        }
      };

      // ⭐ 不在首次读取前启动 idle timer（避免与首字节超时职责重叠）
      // idle timer 仅在首块数据到达后启动，用于检测流中途静默

      const flushAndJoin = (): string => {
        const flushed = decoder.decode();
        if (flushed) {
          chunks.push(flushed);
        }
        return chunks.join("");
      };

      const finalizeStream = async (
        allContent: string,
        streamEndedNormally: boolean,
        clientAborted: boolean,
        abortReason?: string
      ): Promise<void> => {
        const finalized = await finalizeDeferredStreamingFinalizationIfNeeded(
          session,
          allContent,
          statusCode,
          streamEndedNormally,
          clientAborted,
          abortReason
        );
        const effectiveStatusCode = finalized.effectiveStatusCode;
        const streamErrorMessage = finalized.errorMessage;
        const providerIdForPersistence = finalized.providerIdForPersistence;

        // 存储响应体到 Redis（5分钟过期）
        if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
          const beforeBody = (await consumeBeforeResponseBodySnapshot(session)) ?? allContent;
          void SessionManager.storeSessionResponse(
            session.sessionId,
            allContent,
            session.requestSequence
          ).catch((err) => {
            logger.error("[ResponseHandler] Failed to store response:", err);
          });

          const responseAfterSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
            session.sessionId,
            "after",
            { body: allContent },
            session.requestSequence
          );
          responseAfterSnapshotTask?.catch((err) => {
            logger.error("[ResponseHandler] Failed to store response after snapshot:", err);
          });

          const responseBeforeSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
            session.sessionId,
            "before",
            { body: beforeBody },
            session.requestSequence
          );
          responseBeforeSnapshotTask?.catch((err) => {
            logger.error("[ResponseHandler] Failed to store response before snapshot:", err);
          });
        }

        const duration = Date.now() - session.startTime;
        await updateMessageRequestDuration(messageContext.id, duration);

        const tracker = ProxyStatusTracker.getInstance();
        tracker.endRequest(messageContext.user.id, messageContext.id);

        const usageResult = parseUsageFromResponseText(allContent, provider.providerType);
        usageForCost = usageResult.usageMetrics;

        const actualServiceTier = parseServiceTierFromResponseText(allContent);
        const codexPriorityBillingDecision = await resolveCodexPriorityBillingDecision(
          session,
          actualServiceTier
        );
        if (!isNonBillingUsageEndpoint(session)) {
          ensureCodexServiceTierResultSpecialSetting(session, codexPriorityBillingDecision);
        }
        const priorityServiceTierApplied = codexPriorityBillingDecision?.effectivePriority ?? false;

        if (usageForCost) {
          usageForCost = normalizeUsageWithSwap(
            usageForCost,
            session,
            provider.swapCacheTtlBilling
          );
        }

        maybeSetCodexContext1m(session, provider, usageForCost?.input_tokens);

        // Codex: Extract prompt_cache_key from SSE events and update session binding
        if (provider.providerType === "codex" && session.sessionId && provider.id) {
          try {
            const sseEvents = parseSSEData(allContent);
            for (const event of sseEvents) {
              if (typeof event.data === "object" && event.data) {
                const promptCacheKey = SessionManager.extractCodexPromptCacheKey(
                  event.data as Record<string, unknown>
                );
                if (promptCacheKey) {
                  void SessionManager.updateSessionWithCodexCacheKey(
                    session.sessionId,
                    promptCacheKey,
                    provider.id,
                    session.authState?.key?.id ?? session.messageContext?.key?.id ?? null
                  ).catch((err) => {
                    logger.error("[ResponseHandler] Failed to update Codex session (stream):", err);
                  });
                  break; // Only need first prompt_cache_key
                }
              }
            }
          } catch (parseError) {
            logger.trace("[ResponseHandler] Failed to parse SSE for Codex session:", parseError);
          }
        }

        const billableUsageForCost = await resolveBillableUsageMetricsForCost(
          session,
          provider,
          usageForCost,
          effectiveStatusCode
        );

        const costUpdateResult = await updateRequestCostFromUsage(
          messageContext.id,
          session,
          billableUsageForCost,
          provider,
          provider.costMultiplier,
          session.getContext1mApplied(),
          priorityServiceTierApplied,
          session.getGroupCostMultiplier()
        );
        if (costUpdateResult.longContextPricingApplied) {
          ensureLongContextPricingAudit(session, costUpdateResult.longContextPricing);
        }

        // 追踪消费到 Redis（用于限流）
        await trackCostToRedis(
          session,
          billableUsageForCost,
          priorityServiceTierApplied,
          costUpdateResult.resolvedPricing,
          costUpdateResult.longContextPricing
        );

        // Calculate cost for session tracking (with multiplier) and Langfuse (raw)
        let costUsdStr: string | undefined;
        let rawCostUsdStr: string | undefined;
        let costBreakdown: CostBreakdown | undefined;
        if (billableUsageForCost) {
          try {
            if (session.request.model) {
              const resolvedPricing = await session.getResolvedPricingByBillingSource(provider);
              if (resolvedPricing) {
                ensurePricingResolutionSpecialSetting(session, resolvedPricing);
                const longContextPricing =
                  matchLongContextPricing(billableUsageForCost, resolvedPricing.priceData)
                    ?.pricing ?? null;
                const cost = calculateRequestCost(
                  billableUsageForCost,
                  resolvedPricing.priceData,
                  buildCostCalculationOptions(
                    provider.costMultiplier,
                    session.getContext1mApplied(),
                    priorityServiceTierApplied,
                    longContextPricing,
                    session.getGroupCostMultiplier()
                  )
                );
                if (cost.gt(0)) {
                  costUsdStr = cost.toString();
                }
                // Raw cost without multiplier for Langfuse
                if (provider.costMultiplier !== 1 || session.getGroupCostMultiplier() !== 1) {
                  const rawCost = calculateRequestCost(
                    billableUsageForCost,
                    resolvedPricing.priceData,
                    buildCostCalculationOptions(
                      1.0,
                      session.getContext1mApplied(),
                      priorityServiceTierApplied,
                      longContextPricing
                    )
                  );
                  if (rawCost.gt(0)) {
                    rawCostUsdStr = rawCost.toString();
                  }
                } else {
                  rawCostUsdStr = costUsdStr;
                }
                // Cost breakdown for Langfuse (raw, no multiplier)
                try {
                  costBreakdown = calculateRequestCostBreakdown(
                    billableUsageForCost,
                    resolvedPricing.priceData,
                    {
                      context1mApplied: session.getContext1mApplied(),
                      priorityServiceTierApplied,
                      longContextPricing,
                    }
                  );
                } catch {
                  /* non-critical */
                }
              }
            }
          } catch (error) {
            logger.error("[ResponseHandler] Failed to calculate session cost (stream), skipping", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // 更新 session 使用量到 Redis（用于实时监控）
        if (session.sessionId) {
          const payload: SessionUsageUpdate = {
            status: effectiveStatusCode >= 200 && effectiveStatusCode < 300 ? "completed" : "error",
            statusCode: effectiveStatusCode,
            ...(streamErrorMessage ? { errorMessage: streamErrorMessage } : {}),
          };

          if (usageForCost) {
            payload.inputTokens = usageForCost.input_tokens;
            payload.outputTokens = usageForCost.output_tokens;
            payload.cacheCreationInputTokens = usageForCost.cache_creation_input_tokens;
            payload.cacheReadInputTokens = usageForCost.cache_read_input_tokens;
          }
          if (costUsdStr !== undefined) {
            payload.costUsd = costUsdStr;
          }

          if (session.shouldTrackSessionObservability()) {
            void SessionManager.updateSessionUsage(session.sessionId, payload).catch(
              (error: unknown) => {
                logger.error("[ResponseHandler] Failed to update session usage:", error);
              }
            );
          }
        }

        // 保存扩展信息（status code, tokens, provider chain）
        await updateMessageRequestDetails(messageContext.id, {
          statusCode: effectiveStatusCode,
          inputTokens: usageForCost?.input_tokens,
          outputTokens: usageForCost?.output_tokens,
          ttfbMs: session.ttfbMs,
          cacheCreationInputTokens: usageForCost?.cache_creation_input_tokens,
          cacheReadInputTokens: usageForCost?.cache_read_input_tokens,
          cacheCreation5mInputTokens: usageForCost?.cache_creation_5m_input_tokens,
          cacheCreation1hInputTokens: usageForCost?.cache_creation_1h_input_tokens,
          cacheTtlApplied: usageForCost?.cache_ttl ?? null,
          providerChain: session.getProviderChain(),
          ...(streamErrorMessage ? { errorMessage: streamErrorMessage } : {}),
          model: session.getCurrentModel() ?? undefined, // 更新重定向后的模型
          actualResponseModel: extractActualResponseModelForProvider(
            provider.providerType,
            true,
            allContent
          ),
          providerId: providerIdForPersistence ?? session.provider?.id, // 更新最终供应商ID（重试切换后）
          context1mApplied: session.getContext1mApplied(),
          swapCacheTtlApplied: provider.swapCacheTtlBilling ?? false,
          specialSettings: session.getSpecialSettings() ?? undefined,
        });

        emitLangfuseTrace(session, {
          responseHeaders: response.headers,
          responseText: allContent,
          usageMetrics: usageForCost,
          costUsd: rawCostUsdStr,
          costBreakdown,
          statusCode: effectiveStatusCode,
          durationMs: duration,
          isStreaming: true,
          sseEventCount: chunks.length,
          errorMessage: streamErrorMessage ?? undefined,
        });
      };

      try {
        let streamEndedNormally = false;
        while (true) {
          // 检查取消信号
          if (session.clientAbortSignal?.aborted || abortController.signal.aborted) {
            logger.info("ResponseHandler: Stream processing cancelled", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              chunksCollected: chunks.length,
            });
            break; // 提前终止
          }

          const { value, done } = await reader.read();
          if (done) {
            streamEndedNormally = true;
            break;
          }
          if (value) {
            const chunkSize = value.length;
            chunks.push(decoder.decode(value, { stream: true }));

            // ⭐ 每次收到数据后重置静默期计时器（首次收到数据时启动）
            startIdleTimer();
            logger.trace("ResponseHandler: Idle timer reset (data received)", {
              taskId,
              providerId: provider.id,
              chunksCollected: chunks.length,
              lastChunkSize: chunkSize,
              idleTimeoutMs: idleTimeoutMs === Infinity ? "disabled" : idleTimeoutMs,
            });

            // ⭐ 流式：读到第一块数据后立即清除响应超时定时器
            if (isFirstChunk) {
              session.recordTtfb();
              isFirstChunk = false;
              const sessionWithCleanup = session as typeof session & {
                clearResponseTimeout?: () => void;
              };
              if (sessionWithCleanup.clearResponseTimeout) {
                sessionWithCleanup.clearResponseTimeout();
                logger.debug("ResponseHandler: First chunk received, response timeout cleared", {
                  taskId,
                  providerId: provider.id,
                  firstChunkSize: chunkSize,
                });
              }
            }
          }
        }

        // ⭐ 流式读取完成：清除静默期计时器
        clearIdleTimer();
        const allContent = flushAndJoin();
        const clientAborted = session.clientAbortSignal?.aborted ?? false;
        try {
          await finalizeStream(allContent, streamEndedNormally, clientAborted);
        } catch (finalizeError) {
          logger.error("ResponseHandler: Failed to finalize stream", {
            taskId,
            providerId: provider.id,
            providerName: provider.name,
            messageId: messageContext.id,
            streamEndedNormally,
            clientAborted,
            finalizeError,
          });

          // 回退：避免 finalizeStream 失败导致 request record 未被更新
          await persistRequestFailure({
            session,
            messageContext,
            statusCode: statusCode && statusCode >= 400 ? statusCode : 500,
            error: finalizeError,
            taskId,
            phase: "stream",
          });
        }
      } catch (error) {
        // 检测 AbortError 的来源：响应超时 vs 静默期超时 vs 客户端/上游中断
        const err = error as Error;
        const sessionWithController = session as typeof session & {
          responseController?: AbortController;
        };
        const clientAborted = session.clientAbortSignal?.aborted ?? false;
        const isResponseControllerAborted =
          sessionWithController.responseController?.signal.aborted ?? false;

        if (isClientAbortError(err)) {
          // 区分不同的超时来源
          const isResponseTimeout = isResponseControllerAborted && !clientAborted;
          const isIdleTimeout = err.message?.includes("streaming_idle");

          if (isResponseTimeout && !isIdleTimeout) {
            // ⚠️ 响应超时（首字节超时）：计入熔断器并记录错误日志
            logger.error("ResponseHandler: Response timeout during stream body read", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              chunksCollected: chunks.length,
              errorName: err.name,
            });

            // 注意：无法重试，因为客户端已收到 HTTP 200
            // 错误已记录，不抛出异常（避免影响后台任务）

            // 结算并消费 deferred meta，确保 provider chain/熔断归因完整
            try {
              const allContent = flushAndJoin();
              await finalizeStream(allContent, false, false, "STREAM_RESPONSE_TIMEOUT");
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize response-timeout stream", {
                taskId,
                messageId: messageContext.id,
                finalizeError,
              });

              // 回退：至少保证 DB 记录能落下，避免 orphan record
              await persistRequestFailure({
                session,
                messageContext,
                statusCode: statusCode && statusCode >= 400 ? statusCode : 502,
                error: err,
                taskId,
                phase: "stream",
              });
            }
          } else if (isIdleTimeout) {
            // ⚠️ 静默期超时：计入熔断器并记录错误日志
            logger.error("ResponseHandler: Streaming idle timeout", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              chunksCollected: chunks.length,
            });

            // 注意：无法重试，因为客户端已收到 HTTP 200
            // 错误已记录，不抛出异常（避免影响后台任务）

            // 结算并消费 deferred meta，确保 provider chain/熔断归因完整
            try {
              const allContent = flushAndJoin();
              await finalizeStream(allContent, false, false, "STREAM_IDLE_TIMEOUT");
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize idle-timeout stream", {
                taskId,
                messageId: messageContext.id,
                finalizeError,
              });

              // 回退：至少保证 DB 记录能落下，避免 orphan record
              await persistRequestFailure({
                session,
                messageContext,
                statusCode: statusCode && statusCode >= 400 ? statusCode : 502,
                error: err,
                taskId,
                phase: "stream",
              });
            }
          } else if (!clientAborted) {
            // 上游在流式过程中意外中断：视为供应商/网络错误
            logger.error("ResponseHandler: Upstream stream aborted unexpectedly", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              chunksCollected: chunks.length,
              errorName: err.name,
              errorMessage: err.message || "(empty message)",
            });

            // 结算并消费 deferred meta，确保 provider chain/熔断归因完整
            try {
              const allContent = flushAndJoin();
              await finalizeStream(allContent, false, false, "STREAM_UPSTREAM_ABORTED");
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize upstream-aborted stream", {
                taskId,
                messageId: messageContext.id,
                finalizeError,
              });

              // 回退：至少保证 DB 记录能落下，避免 orphan record
              await persistRequestFailure({
                session,
                messageContext,
                statusCode: 502,
                error: err,
                taskId,
                phase: "stream",
              });
            }
          } else {
            // 客户端主动中断：正常日志，不抛出错误
            logger.warn("ResponseHandler: Stream reading aborted by client", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              chunksCollected: chunks.length,
              errorName: err.name,
              reason:
                err.name === "ResponseAborted"
                  ? "Response transmission interrupted"
                  : "Client disconnected",
            });
            try {
              const allContent = flushAndJoin();
              await finalizeStream(allContent, false, true);
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize aborted stream response", {
                taskId,
                messageId: messageContext.id,
                finalizeError,
              });
            }
          }
        } else if (isTransportError(err)) {
          // 上游流传输错误（SocketError, ECONNRESET 等）：与 upstream abort 相同处理
          // 参见 #916 — controller.error(err) 传播的 transport error
          logger.error("ResponseHandler: Upstream stream transport error", {
            taskId,
            providerId: provider.id,
            providerName: provider.name,
            messageId: messageContext.id,
            chunksCollected: chunks.length,
            errorName: err.name,
            errorMessage: err.message || "(empty message)",
            errorCode: (err as NodeJS.ErrnoException).code,
          });

          try {
            const allContent = flushAndJoin();
            await finalizeStream(allContent, false, false, "STREAM_UPSTREAM_ABORTED");
          } catch (finalizeError) {
            logger.error("ResponseHandler: Failed to finalize transport-error stream", {
              taskId,
              messageId: messageContext.id,
              finalizeError,
            });

            await persistRequestFailure({
              session,
              messageContext,
              statusCode: 502,
              error: err,
              taskId,
              phase: "stream",
            });
          }
        } else {
          logger.error("Failed to save SSE content:", error);

          // 结算并消费 deferred meta，确保 provider chain/熔断归因完整
          try {
            const allContent = flushAndJoin();
            await finalizeStream(allContent, false, clientAborted, "STREAM_PROCESSING_ERROR");
          } catch (finalizeError) {
            logger.error("ResponseHandler: Failed to finalize stream after processing error", {
              taskId,
              messageId: messageContext.id,
              finalizeError,
            });

            // 回退：至少保证 DB 记录能落下，避免 orphan record
            await persistRequestFailure({
              session,
              messageContext,
              statusCode: statusCode && statusCode >= 400 ? statusCode : 500,
              error,
              taskId,
              phase: "stream",
            });
          }
        }
      } finally {
        // 确保资源释放
        cleanupClientAbortListener();
        clearIdleTimer(); // ⭐ 清除静默期计时器（防止泄漏）
        try {
          reader.releaseLock();
        } catch (releaseError) {
          logger.warn("Failed to release reader lock", {
            taskId,
            releaseError,
          });
        }
        releaseSessionAgent(session);
        AsyncTaskManager.cleanup(taskId);
      }
    })();

    // 注册任务并添加全局错误捕获
    AsyncTaskManager.register(taskId, processingPromise, "stream-processing");
    processingPromise.catch(async (error) => {
      logger.error("ResponseHandler: Uncaught error in stream processing", {
        taskId,
        messageId: messageContext.id,
        error,
      });

      // 更新数据库记录（避免 orphan record）
      await persistRequestFailure({
        session,
        messageContext,
        statusCode: statusCode && statusCode >= 400 ? statusCode : 500,
        error,
        taskId,
        phase: "stream",
      });
    });

    // ⭐ 修复 Bun 运行时的 Transfer-Encoding 重复问题
    // 清理上游的传输 headers，让 Response API 自动管理
    const finalStreamHeaders = cleanResponseHeaders(response.headers);
    if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
      const responseAfterMetaTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
        session.sessionId,
        "after",
        {
          headers: finalStreamHeaders,
          meta: {
            upstreamUrl: null,
            statusCode: response.status,
          },
        },
        session.requestSequence
      );
      responseAfterMetaTask?.catch((err) => {
        logger.error("[ResponseHandler] Failed to store stream response after meta:", err);
      });
    }

    return new Response(clientStream, {
      status: response.status,
      statusText: response.statusText,
      headers: finalStreamHeaders,
    });
  }
}

export function extractUsageMetrics(value: unknown): UsageMetrics | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const usage = value as Record<string, unknown>;
  const result: UsageMetrics = {};
  let hasAny = false;

  if (typeof usage.input_tokens === "number") {
    result.input_tokens = usage.input_tokens;
    hasAny = true;
  }

  // Gemini support
  // 注意：promptTokenCount 包含 cachedContentTokenCount，需要减去以避免重复计费
  // 计费公式：input = (promptTokenCount - cachedContentTokenCount) × input_price
  //          cache = cachedContentTokenCount × cache_price
  if (typeof usage.promptTokenCount === "number") {
    const cachedTokens =
      typeof usage.cachedContentTokenCount === "number" ? usage.cachedContentTokenCount : 0;
    result.input_tokens = Math.max(usage.promptTokenCount - cachedTokens, 0);
    hasAny = true;
  }
  if (typeof usage.candidatesTokenCount === "number") {
    result.output_tokens = usage.candidatesTokenCount;
    hasAny = true;
  }

  // OpenAI chat completion format: prompt_tokens → input_tokens
  // Priority: Claude (input_tokens) > Gemini (candidatesTokenCount) > OpenAI (prompt_tokens)
  if (result.input_tokens === undefined && typeof usage.prompt_tokens === "number") {
    result.input_tokens = usage.prompt_tokens;
    hasAny = true;
  }
  // Gemini 缓存支持
  if (typeof usage.cachedContentTokenCount === "number") {
    result.cache_read_input_tokens = usage.cachedContentTokenCount;
    hasAny = true;
  }

  // Gemini modality-specific token details (IMAGE/TEXT)
  // candidatesTokensDetails: 输出 token 按 modality 分类
  const candidatesDetails = usage.candidatesTokensDetails as
    | Array<{ modality?: string; tokenCount?: number }>
    | undefined;
  if (Array.isArray(candidatesDetails) && candidatesDetails.length > 0) {
    let imageTokens = 0;
    let textTokens = 0;
    let hasValidToken = false;
    for (const detail of candidatesDetails) {
      if (typeof detail.tokenCount === "number" && detail.tokenCount > 0) {
        hasValidToken = true;
        const modalityUpper = detail.modality?.toUpperCase();
        if (modalityUpper === "IMAGE") {
          imageTokens += detail.tokenCount;
        } else {
          textTokens += detail.tokenCount;
        }
      }
    }
    if (imageTokens > 0) {
      result.output_image_tokens = imageTokens;
      hasAny = true;
    }
    if (hasValidToken) {
      // 计算未分类的 TEXT tokens: candidatesTokenCount - details总和
      // 这些可能是图片生成的内部开销，按 TEXT 价格计费
      const detailsSum = imageTokens + textTokens;
      const candidatesTotal =
        typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : 0;
      const unaccountedTokens = Math.max(candidatesTotal - detailsSum, 0);
      result.output_tokens = textTokens + unaccountedTokens;
      hasAny = true;
    }
  }

  // promptTokensDetails: 输入 token 按 modality 分类
  const promptDetails = usage.promptTokensDetails as
    | Array<{ modality?: string; tokenCount?: number }>
    | undefined;
  if (Array.isArray(promptDetails) && promptDetails.length > 0) {
    let imageTokens = 0;
    let textTokens = 0;
    let hasValidToken = false;
    for (const detail of promptDetails) {
      if (typeof detail.tokenCount === "number" && detail.tokenCount > 0) {
        hasValidToken = true;
        const modalityUpper = detail.modality?.toUpperCase();
        if (modalityUpper === "IMAGE") {
          imageTokens += detail.tokenCount;
        } else {
          textTokens += detail.tokenCount;
        }
      }
    }
    if (imageTokens > 0) {
      result.input_image_tokens = imageTokens;
      hasAny = true;
    }
    if (hasValidToken) {
      result.input_tokens = textTokens;
      hasAny = true;
    }
  }

  if (typeof usage.output_tokens === "number") {
    result.output_tokens = usage.output_tokens;
    hasAny = true;
  }

  // Gemini 思考/推理 token：直接累加到 output_tokens（思考价格与输出价格相同）
  // 注意：放在 output_tokens 赋值之后，避免被覆盖
  // output_tokens 是转换的时候才存在的，gemini原生接口的没有该值
  // 通常存在 output_tokens的时候，thoughtsTokenCount=0
  if (typeof usage.thoughtsTokenCount === "number" && usage.thoughtsTokenCount > 0) {
    result.output_tokens = (result.output_tokens ?? 0) + usage.thoughtsTokenCount;
    hasAny = true;
  }

  // OpenAI chat completion format: completion_tokens → output_tokens
  // Priority: Claude (output_tokens) > Gemini (candidatesTokenCount/thoughtsTokenCount) > OpenAI (completion_tokens)
  if (result.output_tokens === undefined && typeof usage.completion_tokens === "number") {
    result.output_tokens = usage.completion_tokens;
    hasAny = true;
  }

  if (typeof usage.cache_creation_input_tokens === "number") {
    result.cache_creation_input_tokens = usage.cache_creation_input_tokens;
    hasAny = true;
  }

  const cacheCreationDetails = usage.cache_creation as Record<string, unknown> | undefined;
  let cacheCreationDetailedTotal = 0;

  if (cacheCreationDetails) {
    if (typeof cacheCreationDetails.ephemeral_5m_input_tokens === "number") {
      result.cache_creation_5m_input_tokens = cacheCreationDetails.ephemeral_5m_input_tokens;
      cacheCreationDetailedTotal += cacheCreationDetails.ephemeral_5m_input_tokens;
      hasAny = true;
    }
    if (typeof cacheCreationDetails.ephemeral_1h_input_tokens === "number") {
      result.cache_creation_1h_input_tokens = cacheCreationDetails.ephemeral_1h_input_tokens;
      cacheCreationDetailedTotal += cacheCreationDetails.ephemeral_1h_input_tokens;
      hasAny = true;
    }
  }

  // 兼容顶层扁平格式：cache_creation_5m_input_tokens / cache_creation_1h_input_tokens
  // 部分供应商/relay 直接在顶层返回细分字段，而非嵌套在 cache_creation 对象中
  // 优先级：嵌套格式 > 顶层扁平格式 > 旧 relay 格式
  if (
    result.cache_creation_5m_input_tokens === undefined &&
    typeof usage.cache_creation_5m_input_tokens === "number"
  ) {
    result.cache_creation_5m_input_tokens = usage.cache_creation_5m_input_tokens;
    cacheCreationDetailedTotal += usage.cache_creation_5m_input_tokens;
    hasAny = true;
  }
  if (
    result.cache_creation_1h_input_tokens === undefined &&
    typeof usage.cache_creation_1h_input_tokens === "number"
  ) {
    result.cache_creation_1h_input_tokens = usage.cache_creation_1h_input_tokens;
    cacheCreationDetailedTotal += usage.cache_creation_1h_input_tokens;
    hasAny = true;
  }

  // 兼容部分 relay / 旧字段命名：claude_cache_creation_5_m_tokens / claude_cache_creation_1_h_tokens
  // 仅在标准字段缺失时使用，避免重复统计（优先级最低）
  if (
    result.cache_creation_5m_input_tokens === undefined &&
    typeof usage.claude_cache_creation_5_m_tokens === "number"
  ) {
    result.cache_creation_5m_input_tokens = usage.claude_cache_creation_5_m_tokens;
    cacheCreationDetailedTotal += usage.claude_cache_creation_5_m_tokens;
    hasAny = true;
  }
  if (
    result.cache_creation_1h_input_tokens === undefined &&
    typeof usage.claude_cache_creation_1_h_tokens === "number"
  ) {
    result.cache_creation_1h_input_tokens = usage.claude_cache_creation_1_h_tokens;
    cacheCreationDetailedTotal += usage.claude_cache_creation_1_h_tokens;
    hasAny = true;
  }

  if (result.cache_creation_input_tokens === undefined && cacheCreationDetailedTotal > 0) {
    result.cache_creation_input_tokens = cacheCreationDetailedTotal;
  }

  if (!result.cache_ttl) {
    if (result.cache_creation_1h_input_tokens && result.cache_creation_5m_input_tokens) {
      result.cache_ttl = "mixed";
    } else if (result.cache_creation_1h_input_tokens) {
      result.cache_ttl = "1h";
    } else if (result.cache_creation_5m_input_tokens) {
      result.cache_ttl = "5m";
    }
  }

  // Claude 格式：顶层 cache_read_input_tokens（扁平结构）
  if (typeof usage.cache_read_input_tokens === "number") {
    result.cache_read_input_tokens = usage.cache_read_input_tokens;
    hasAny = true;
  }

  if (result.cache_read_input_tokens === undefined) {
    const inputTokensDetails = usage.input_tokens_details as Record<string, unknown> | undefined;
    if (inputTokensDetails && typeof inputTokensDetails.cached_tokens === "number") {
      result.cache_read_input_tokens = inputTokensDetails.cached_tokens;
      hasAny = true;
      logger.debug("[ResponseHandler] Parsed cached tokens from OpenAI Response API format", {
        cachedTokens: inputTokensDetails.cached_tokens,
      });
    }
  }

  if (result.cache_read_input_tokens === undefined) {
    const promptTokensDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
    if (promptTokensDetails && typeof promptTokensDetails.cached_tokens === "number") {
      result.cache_read_input_tokens = promptTokensDetails.cached_tokens;
      hasAny = true;
      logger.debug("[ResponseHandler] Parsed cached tokens from OpenAI Chat Completions format", {
        cachedTokens: promptTokensDetails.cached_tokens,
      });
    }
  }

  return hasAny ? result : null;
}

export function parseUsageFromResponseText(
  responseText: string,
  providerType: string | null | undefined
): {
  usageRecord: Record<string, unknown> | null;
  usageMetrics: UsageMetrics | null;
} {
  let usageRecord: Record<string, unknown> | null = null;
  let usageMetrics: UsageMetrics | null = null;

  const applyUsageValue = (value: unknown, source: string) => {
    if (usageMetrics) {
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const extracted = extractUsageMetrics(value);
    if (!extracted) {
      return;
    }

    usageRecord = value as Record<string, unknown>;
    usageMetrics = adjustUsageForProviderType(extracted, providerType);

    logger.debug("[ResponseHandler] Parsed usage from response", {
      source,
      providerType,
      usage: usageMetrics,
    });
  };

  try {
    const parsedValue = JSON.parse(responseText);

    if (parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)) {
      const parsed = parsedValue as Record<string, unknown>;

      // Standard usage fields
      applyUsageValue(parsed.usage, "json.root.usage");

      // Gemini usageMetadata (direct)
      applyUsageValue(parsed.usageMetadata, "json.root.usageMetadata");

      // Handle response wrapping (some Gemini providers return {response: {...}})
      if (parsed.response && typeof parsed.response === "object") {
        const responseObj = parsed.response as Record<string, unknown>;
        applyUsageValue(responseObj.usage, "json.response.usage");
        applyUsageValue(responseObj.usageMetadata, "json.response.usageMetadata");
      }

      if (Array.isArray(parsed.output)) {
        for (const item of parsed.output as Array<Record<string, unknown>>) {
          if (!item || typeof item !== "object") {
            continue;
          }
          applyUsageValue(item.usage, "json.output");
        }
      }
    }

    if (!usageMetrics && Array.isArray(parsedValue)) {
      for (const item of parsedValue) {
        if (!item || typeof item !== "object") {
          continue;
        }

        const record = item as Record<string, unknown>;
        applyUsageValue(record.usage, "json.array");

        if (record.data && typeof record.data === "object") {
          applyUsageValue((record.data as Record<string, unknown>).usage, "json.array.data");
        }
      }
    }
  } catch {
    // Fallback to SSE parsing when body is not valid JSON
  }

  // SSE 解析：支持两种格式
  // 1. 标准 SSE (event: + data:) - Claude/OpenAI
  // 2. 纯 data: 格式 - Gemini
  if (!usageMetrics && isSSEText(responseText)) {
    const events = parseSSEData(responseText);

    // Claude SSE 特殊处理：
    // - message_delta 通常包含更完整的 usage（应优先使用）
    // - message_start 可能包含 cache_creation 的 TTL 细分字段（作为缺失字段的补充）
    let messageStartUsage: UsageMetrics | null = null;
    let messageDeltaUsage: UsageMetrics | null = null;

    // Gemini SSE: usageMetadata 需要 last-wins（完整 token 计数仅在最后事件中）
    let lastGeminiUsage: UsageMetrics | null = null;
    let lastGeminiUsageRecord: Record<string, unknown> | null = null;

    const mergeUsageMetrics = (base: UsageMetrics | null, patch: UsageMetrics): UsageMetrics => {
      if (!base) {
        return { ...patch };
      }

      return {
        input_tokens: patch.input_tokens ?? base.input_tokens,
        output_tokens: patch.output_tokens ?? base.output_tokens,
        cache_creation_input_tokens:
          patch.cache_creation_input_tokens ?? base.cache_creation_input_tokens,
        cache_creation_5m_input_tokens:
          patch.cache_creation_5m_input_tokens ?? base.cache_creation_5m_input_tokens,
        cache_creation_1h_input_tokens:
          patch.cache_creation_1h_input_tokens ?? base.cache_creation_1h_input_tokens,
        cache_ttl: patch.cache_ttl ?? base.cache_ttl,
        cache_read_input_tokens: patch.cache_read_input_tokens ?? base.cache_read_input_tokens,
      };
    };

    for (const event of events) {
      if (typeof event.data !== "object" || !event.data) {
        continue;
      }

      const data = event.data as Record<string, unknown>;

      if (event.event === "message_start") {
        // Claude message_start format: data.message.usage
        // 部分 relay 可能是 data.usage（无 message 包裹）
        let usageValue: unknown = null;
        if (data.message && typeof data.message === "object") {
          const messageObj = data.message as Record<string, unknown>;
          usageValue = messageObj.usage;
        }
        if (!usageValue) {
          usageValue = data.usage;
        }

        if (usageValue && typeof usageValue === "object") {
          const extracted = extractUsageMetrics(usageValue);
          if (extracted) {
            messageStartUsage = mergeUsageMetrics(messageStartUsage, extracted);
            logger.debug("[ResponseHandler] Extracted usage from message_start", {
              source:
                usageValue === data.usage
                  ? "sse.message_start.usage"
                  : "sse.message_start.message.usage",
              usage: extracted,
            });
          }
        }
      }

      if (event.event === "message_delta") {
        // Claude message_delta format: data.usage
        let usageValue: unknown = data.usage;
        if (!usageValue && data.delta && typeof data.delta === "object") {
          usageValue = (data.delta as Record<string, unknown>).usage;
        }

        if (usageValue && typeof usageValue === "object") {
          const extracted = extractUsageMetrics(usageValue);
          if (extracted) {
            messageDeltaUsage = mergeUsageMetrics(messageDeltaUsage, extracted);
            logger.debug("[ResponseHandler] Extracted usage from message_delta", {
              source: "sse.message_delta.usage",
              usage: extracted,
            });
          }
        }
      }

      // 非 Claude 格式的 SSE 处理（Gemini 等）
      // 注意：Gemini SSE 流中，usageMetadata 在每个事件中都可能存在，
      // 但只有最后一个事件包含完整的 token 计数（candidatesTokenCount、thoughtsTokenCount 等）
      // 因此需要持续更新，使用最后一个有效值
      if (!messageStartUsage && !messageDeltaUsage) {
        // Standard usage fields (data.usage) - 仍使用 first-wins 策略
        applyUsageValue(data.usage, `sse.${event.event}.usage`);

        // Gemini usageMetadata - 改为 last-wins 策略
        // 跳过 applyUsageValue（它是 first-wins），直接更新
        if (data.usageMetadata && typeof data.usageMetadata === "object") {
          const extracted = extractUsageMetrics(data.usageMetadata);
          if (extracted) {
            // 持续更新，最后一个有效值会覆盖之前的
            lastGeminiUsage = extracted;
            lastGeminiUsageRecord = data.usageMetadata as Record<string, unknown>;
          }
        }

        // Handle response wrapping in SSE
        if (!usageMetrics && data.response && typeof data.response === "object") {
          const responseObj = data.response as Record<string, unknown>;
          applyUsageValue(responseObj.usage, `sse.${event.event}.response.usage`);

          // response.usageMetadata 也使用 last-wins 策略
          if (responseObj.usageMetadata && typeof responseObj.usageMetadata === "object") {
            const extracted = extractUsageMetrics(responseObj.usageMetadata);
            if (extracted) {
              lastGeminiUsage = extracted;
              lastGeminiUsageRecord = responseObj.usageMetadata as Record<string, unknown>;
            }
          }
        }
      }
    }

    // Claude SSE 合并规则：优先使用 message_delta，缺失字段再回退到 message_start
    const mergedClaudeUsage = (() => {
      if (messageDeltaUsage && messageStartUsage) {
        return mergeUsageMetrics(messageStartUsage, messageDeltaUsage);
      }
      return messageDeltaUsage ?? messageStartUsage;
    })();

    if (mergedClaudeUsage) {
      usageMetrics = adjustUsageForProviderType(mergedClaudeUsage, providerType);
      usageRecord = mergedClaudeUsage as unknown as Record<string, unknown>;
      logger.debug("[ResponseHandler] Final merged usage from Claude SSE", {
        providerType,
        usage: usageMetrics,
      });
    }

    // Gemini SSE 处理：使用最后一个有效的 usageMetadata
    // 仅当 Claude SSE 没有提供 usage 且 applyUsageValue 也没有找到时才使用
    if (!usageMetrics && lastGeminiUsage) {
      usageMetrics = adjustUsageForProviderType(lastGeminiUsage, providerType);
      usageRecord = lastGeminiUsageRecord;
      logger.debug("[ResponseHandler] Final usage from Gemini SSE (last event)", {
        providerType,
        usage: usageMetrics,
      });
    }
  }

  return { usageRecord, usageMetrics };
}

function adjustUsageForProviderType(
  usage: UsageMetrics,
  providerType: string | null | undefined
): UsageMetrics {
  if (providerType !== "codex") {
    return usage;
  }

  const cachedTokens = usage.cache_read_input_tokens;
  const inputTokens = usage.input_tokens;

  if (typeof cachedTokens !== "number" || typeof inputTokens !== "number") {
    return usage;
  }

  const adjustedInput = Math.max(inputTokens - cachedTokens, 0);
  if (adjustedInput === inputTokens) {
    return usage;
  }

  logger.debug("[UsageMetrics] Adjusted codex input tokens to exclude cached tokens", {
    providerType,
    originalInputTokens: inputTokens,
    cachedTokens,
    adjustedInputTokens: adjustedInput,
  });

  return {
    ...usage,
    input_tokens: adjustedInput,
  };
}

/**
 * Swap 5m/1h cache buckets and cache_ttl when provider.swapCacheTtlBilling is enabled.
 * Mutates in-place.
 */
export function applySwapCacheTtlBilling(usage: UsageMetrics, swap: boolean | undefined): void {
  if (!swap) return;
  [usage.cache_creation_5m_input_tokens, usage.cache_creation_1h_input_tokens] = [
    usage.cache_creation_1h_input_tokens,
    usage.cache_creation_5m_input_tokens,
  ];
  if (usage.cache_ttl === "5m") usage.cache_ttl = "1h";
  else if (usage.cache_ttl === "1h") usage.cache_ttl = "5m";
}

/**
 * Apply swap + resolve session fallback cache_ttl + normalize cache buckets.
 * Returns a new UsageMetrics object with consistent bucket routing.
 * The input object is NOT mutated -- swap is applied to an internal clone.
 */
function normalizeUsageWithSwap(
  usageMetrics: UsageMetrics,
  session: ProxySession,
  swapCacheTtlBilling?: boolean
): UsageMetrics {
  // Clone before mutating to prevent caller side-effects and double-swap risks
  const swapped = { ...usageMetrics };
  applySwapCacheTtlBilling(swapped, swapCacheTtlBilling);

  let resolvedCacheTtl = swapped.cache_ttl ?? session.getCacheTtlResolved?.() ?? null;

  // When the upstream response had no cache_ttl，we fell through to the session-level
  // getCacheTtlResolved() fallback which reflects the *original* (un-swapped) value.
  // We must invert it here to stay consistent with the already-swapped bucket tokens.
  if (swapCacheTtlBilling && !usageMetrics.cache_ttl) {
    if (resolvedCacheTtl === "5m") resolvedCacheTtl = "1h";
    else if (resolvedCacheTtl === "1h") resolvedCacheTtl = "5m";
  }

  const cache5m =
    swapped.cache_creation_5m_input_tokens ??
    (resolvedCacheTtl === "1h" ? undefined : swapped.cache_creation_input_tokens);
  const cache1h =
    swapped.cache_creation_1h_input_tokens ??
    (resolvedCacheTtl === "1h" ? swapped.cache_creation_input_tokens : undefined);
  const cacheTotal =
    swapped.cache_creation_input_tokens ?? ((cache5m ?? 0) + (cache1h ?? 0) || undefined);

  return {
    ...swapped,
    cache_ttl: resolvedCacheTtl ?? swapped.cache_ttl,
    cache_creation_5m_input_tokens: cache5m,
    cache_creation_1h_input_tokens: cache1h,
    cache_creation_input_tokens: cacheTotal,
  };
}

async function updateRequestCostFromUsage(
  messageId: number,
  session: ProxySession,
  usage: UsageMetrics | null,
  provider: Provider | null,
  costMultiplier: number = 1.0,
  context1mApplied: boolean = false,
  priorityServiceTierApplied: boolean = false,
  groupCostMultiplier: number = 1.0
): Promise<{
  costUsd: string | null;
  resolvedPricing: Awaited<ReturnType<ProxySession["getResolvedPricingByBillingSource"]>> | null;
  longContextPricing: ResolvedLongContextPricing | null;
  longContextPricingApplied: boolean;
}> {
  if (!usage) {
    logger.warn("[CostCalculation] No usage data, skipping cost update", {
      messageId,
    });
    return {
      costUsd: null,
      resolvedPricing: null,
      longContextPricing: null,
      longContextPricingApplied: false,
    };
  }

  if (isNonBillingUsageEndpoint(session)) {
    return {
      costUsd: null,
      resolvedPricing: null,
      longContextPricing: null,
      longContextPricingApplied: false,
    };
  }

  const originalModel = session.getOriginalModel();
  const redirectedModel = session.getCurrentModel();

  if (!originalModel && !redirectedModel) {
    logger.warn("[CostCalculation] No model name available", { messageId });
    return {
      costUsd: null,
      resolvedPricing: null,
      longContextPricing: null,
      longContextPricingApplied: false,
    };
  }

  try {
    const resolvedPricing = await session.getResolvedPricingByBillingSource(provider);

    if (!resolvedPricing?.priceData || !hasValidPriceData(resolvedPricing.priceData)) {
      logger.warn("[CostCalculation] No price data found, skipping billing", {
        messageId,
        originalModel,
        redirectedModel,
      });

      requestCloudPriceTableSync({ reason: "missing-model" });
      return {
        costUsd: null,
        resolvedPricing: null,
        longContextPricing: null,
        longContextPricingApplied: false,
      };
    }

    const longContextPricing =
      matchLongContextPricing(usage, resolvedPricing.priceData)?.pricing ?? null;
    const cost = calculateRequestCost(
      usage,
      resolvedPricing.priceData,
      buildCostCalculationOptions(
        costMultiplier,
        context1mApplied,
        priorityServiceTierApplied,
        longContextPricing,
        groupCostMultiplier
      )
    );

    // Calculate and store cost breakdown
    let storedBreakdown: StoredCostBreakdown | undefined;
    try {
      const breakdown = calculateRequestCostBreakdown(usage, resolvedPricing.priceData, {
        context1mApplied,
        priorityServiceTierApplied,
        longContextPricing,
      });
      const baseTotal = new Decimal(breakdown.input)
        .plus(breakdown.output)
        .plus(breakdown.cache_creation)
        .plus(breakdown.cache_read);
      // Use the same sanitization rules as calculateRequestCost so that
      // total === base_total * provider_multiplier * group_multiplier
      // holds even when the caller passes NaN / Infinity / negative values.
      storedBreakdown = {
        input: String(breakdown.input),
        output: String(breakdown.output),
        cache_creation: String(breakdown.cache_creation),
        cache_creation_5m: String(breakdown.cache_creation_5m),
        cache_creation_1h: String(breakdown.cache_creation_1h),
        cache_read: String(breakdown.cache_read),
        base_total: baseTotal.toDecimalPlaces(COST_SCALE).toString(),
        provider_multiplier: sanitizeMultiplier(costMultiplier),
        group_multiplier: sanitizeMultiplier(groupCostMultiplier),
        total: cost.toString(),
      };
    } catch {
      /* non-critical */
    }

    logger.info("[CostCalculation] Cost calculated successfully", {
      messageId,
      usedModelForPricing: resolvedPricing.resolvedModelName,
      resolvedPricingProviderKey: resolvedPricing.resolvedPricingProviderKey,
      pricingResolutionSource: resolvedPricing.source,
      costUsd: cost.toString(),
      costMultiplier,
      groupCostMultiplier,
      usage,
    });

    if (cost.gt(0)) {
      await updateMessageRequestCostWithBreakdown(messageId, cost, storedBreakdown);
      return {
        costUsd: cost.toString(),
        resolvedPricing,
        longContextPricing,
        longContextPricingApplied: longContextPricing != null,
      };
    } else {
      logger.warn("[CostCalculation] Calculated cost is zero or negative", {
        messageId,
        usedModelForPricing: resolvedPricing.resolvedModelName,
        resolvedPricingProviderKey: resolvedPricing.resolvedPricingProviderKey,
        costUsd: cost.toString(),
        priceData: {
          inputCost: resolvedPricing.priceData.input_cost_per_token,
          outputCost: resolvedPricing.priceData.output_cost_per_token,
        },
      });
    }
    return {
      costUsd: null,
      resolvedPricing,
      longContextPricing,
      longContextPricingApplied: longContextPricing != null,
    };
  } catch (error) {
    logger.error("[CostCalculation] Failed to update request cost, skipping billing", {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      costUsd: null,
      resolvedPricing: null,
      longContextPricing: null,
      longContextPricingApplied: false,
    };
  }
}

/**
 * 统一的请求统计处理方法
 * 用于消除 Gemini 透传、普通非流式、普通流式之间的重复统计逻辑
 *
 * @param statusCode - 内部结算状态码（可能与客户端实际收到的 HTTP 状态不同，例如“假 200”会被推断并映射为更贴近语义的 4xx/5xx；
 *                   未命中推断规则时回退为 502）
 * @param errorMessage - 可选的内部错误原因（用于把假 200/解析失败等信息写入 DB 与监控）
 */
export async function finalizeRequestStats(
  session: ProxySession,
  responseText: string,
  statusCode: number,
  duration: number,
  errorMessage?: string,
  providerIdOverride?: number,
  /**
   * 是否流式上下文。调用方已知时必须显式传入:
   * - Gemini 透传 NDJSON 没有 `data:`/`event:` 头,isSSEText() 会判成非流式,
   *   导致 extractActualResponseModelForProvider 走 non-stream JSON.parse 失败
   * - 如果不传则回退为 isSSEText 嗅探(仅兼容保留)
   */
  isStreaming?: boolean
): Promise<UsageMetrics | null> {
  const { messageContext, provider } = session;
  if (!provider || !messageContext) {
    return null;
  }
  const resolvedIsStream = isStreaming ?? isSSEText(responseText);

  const providerIdForPersistence = providerIdOverride ?? session.provider?.id;
  const { usageMetrics } = parseUsageFromResponseText(responseText, provider.providerType);
  const actualServiceTier = parseServiceTierFromResponseText(responseText);
  const codexPriorityBillingDecision = await resolveCodexPriorityBillingDecision(
    session,
    actualServiceTier
  );
  if (!isNonBillingUsageEndpoint(session)) {
    ensureCodexServiceTierResultSpecialSetting(session, codexPriorityBillingDecision);
  }
  const priorityServiceTierApplied = codexPriorityBillingDecision?.effectivePriority ?? false;
  if (!usageMetrics) {
    const billablePerRequestUsage = await resolveBillableUsageMetricsForCost(
      session,
      provider,
      null,
      statusCode
    );
    let perRequestCostUsd: string | undefined;

    if (billablePerRequestUsage) {
      const costUpdateResult = await updateRequestCostFromUsage(
        messageContext.id,
        session,
        billablePerRequestUsage,
        provider,
        provider.costMultiplier,
        session.getContext1mApplied(),
        priorityServiceTierApplied,
        session.getGroupCostMultiplier()
      );
      if (costUpdateResult.resolvedPricing) {
        ensurePricingResolutionSpecialSetting(session, costUpdateResult.resolvedPricing);
      }
      if (costUpdateResult.longContextPricingApplied) {
        ensureLongContextPricingAudit(session, costUpdateResult.longContextPricing);
      }

      await trackCostToRedis(
        session,
        billablePerRequestUsage,
        priorityServiceTierApplied,
        costUpdateResult.resolvedPricing,
        costUpdateResult.longContextPricing
      );
      perRequestCostUsd = costUpdateResult.costUsd ?? undefined;
    }

    if (
      session.sessionId &&
      perRequestCostUsd !== undefined &&
      session.shouldTrackSessionObservability()
    ) {
      void SessionManager.updateSessionUsage(session.sessionId, {
        costUsd: perRequestCostUsd,
        status: statusCode >= 200 && statusCode < 300 ? "completed" : "error",
        statusCode,
      }).catch((error: unknown) => {
        logger.error("[ResponseHandler] Failed to update session usage:", error);
      });
    }

    await updateMessageRequestDetails(messageContext.id, {
      statusCode: statusCode,
      ...(errorMessage ? { errorMessage } : {}),
      ttfbMs: session.ttfbMs ?? duration,
      providerChain: session.getProviderChain(),
      model: session.getCurrentModel() ?? undefined,
      actualResponseModel: extractActualResponseModelForProvider(
        provider.providerType,
        resolvedIsStream,
        responseText
      ),
      providerId: providerIdForPersistence,
      context1mApplied: session.getContext1mApplied(),
      swapCacheTtlApplied: session.provider?.swapCacheTtlBilling ?? false,
      specialSettings: session.getSpecialSettings() ?? undefined,
    });
    return null;
  }

  // 4. 更新成本
  // Invert cache TTL at data entry when provider option is enabled
  // All downstream (badge, cost, DB, logs) will see inverted values
  const normalizedUsage = normalizeUsageWithSwap(
    usageMetrics,
    session,
    provider.swapCacheTtlBilling
  );
  const billableNormalizedUsage = !isNonBillingUsageEndpoint(session) ? normalizedUsage : null;

  // 非计费端点（count_tokens / compact）不得触发 Codex 1M 上下文开关，
  // 否则会影响同 session 后续真实请求的账单口径。
  if (billableNormalizedUsage) {
    maybeSetCodexContext1m(session, provider, billableNormalizedUsage.input_tokens);
  }

  const costUpdateResult = await updateRequestCostFromUsage(
    messageContext.id,
    session,
    normalizedUsage,
    provider,
    provider.costMultiplier,
    session.getContext1mApplied(),
    priorityServiceTierApplied,
    session.getGroupCostMultiplier()
  );
  if (costUpdateResult.longContextPricingApplied) {
    ensureLongContextPricingAudit(session, costUpdateResult.longContextPricing);
  }

  // 5. 追踪消费到 Redis（用于限流）
  await trackCostToRedis(
    session,
    normalizedUsage,
    priorityServiceTierApplied,
    costUpdateResult.resolvedPricing,
    costUpdateResult.longContextPricing
  );

  // 6. 更新 session usage
  if (session.sessionId) {
    let costUsdStr: string | undefined;
    try {
      if (billableNormalizedUsage && session.request.model) {
        const resolvedPricing = await session.getResolvedPricingByBillingSource(provider);
        if (resolvedPricing) {
          ensurePricingResolutionSpecialSetting(session, resolvedPricing);
          const longContextPricing =
            matchLongContextPricing(billableNormalizedUsage, resolvedPricing.priceData)?.pricing ??
            null;
          const cost = calculateRequestCost(
            billableNormalizedUsage,
            resolvedPricing.priceData,
            buildCostCalculationOptions(
              provider.costMultiplier,
              session.getContext1mApplied(),
              priorityServiceTierApplied,
              longContextPricing,
              session.getGroupCostMultiplier()
            )
          );
          if (cost.gt(0)) {
            costUsdStr = cost.toString();
          }
        }
      }
    } catch (error) {
      logger.error("[ResponseHandler] Failed to calculate session cost (finalize), skipping", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (session.shouldTrackSessionObservability()) {
      void SessionManager.updateSessionUsage(session.sessionId, {
        inputTokens: normalizedUsage.input_tokens,
        outputTokens: normalizedUsage.output_tokens,
        cacheCreationInputTokens: normalizedUsage.cache_creation_input_tokens,
        cacheReadInputTokens: normalizedUsage.cache_read_input_tokens,
        costUsd: costUsdStr,
        status: statusCode >= 200 && statusCode < 300 ? "completed" : "error",
        statusCode: statusCode,
        ...(errorMessage ? { errorMessage } : {}),
      }).catch((error: unknown) => {
        logger.error("[ResponseHandler] Failed to update session usage:", error);
      });
    }
  }

  // 7. 更新请求详情
  await updateMessageRequestDetails(messageContext.id, {
    statusCode: statusCode,
    inputTokens: normalizedUsage.input_tokens,
    outputTokens: normalizedUsage.output_tokens,
    ttfbMs: session.ttfbMs ?? duration,
    cacheCreationInputTokens: normalizedUsage.cache_creation_input_tokens,
    cacheReadInputTokens: normalizedUsage.cache_read_input_tokens,
    cacheCreation5mInputTokens: normalizedUsage.cache_creation_5m_input_tokens,
    cacheCreation1hInputTokens: normalizedUsage.cache_creation_1h_input_tokens,
    cacheTtlApplied: normalizedUsage.cache_ttl ?? null,
    providerChain: session.getProviderChain(),
    ...(errorMessage ? { errorMessage } : {}),
    model: session.getCurrentModel() ?? undefined,
    actualResponseModel: extractActualResponseModelForProvider(
      provider.providerType,
      resolvedIsStream,
      responseText
    ),
    providerId: providerIdForPersistence, // 更新最终供应商ID（重试切换后）
    context1mApplied: session.getContext1mApplied(),
    swapCacheTtlApplied: provider.swapCacheTtlBilling ?? false,
    specialSettings: session.getSpecialSettings() ?? undefined,
  });

  if (session.sessionId && session.requestSequence != null) {
    if (session.shouldTrackSessionObservability()) {
      void deleteLiveChain(session.sessionId, session.requestSequence);
    }
  }

  return normalizedUsage;
}

/**
 * 追踪消费到 Redis（用于限流）
 */
async function trackCostToRedis(
  session: ProxySession,
  usage: UsageMetrics | null,
  priorityServiceTierApplied: boolean = false,
  resolvedPricingOverride?: Awaited<
    ReturnType<ProxySession["getResolvedPricingByBillingSource"]>
  > | null,
  longContextPricingOverride?: ResolvedLongContextPricing | null
): Promise<void> {
  if (!usage || !session.sessionId) return;
  if (isNonBillingUsageEndpoint(session)) return;

  try {
    const messageContext = session.messageContext;
    const provider = session.provider;
    const key = session.authState?.key;
    const user = session.authState?.user;

    if (!messageContext || !provider || !key || !user) return;

    const modelName = session.request.model;
    if (!modelName) return;

    const resolvedPricing =
      resolvedPricingOverride === undefined
        ? await session.getResolvedPricingByBillingSource(provider)
        : resolvedPricingOverride;
    if (!resolvedPricing) return;

    ensurePricingResolutionSpecialSetting(session, resolvedPricing);
    const longContextPricing =
      longContextPricingOverride === undefined
        ? (matchLongContextPricing(usage, resolvedPricing.priceData)?.pricing ?? null)
        : longContextPricingOverride;

    const cost = calculateRequestCost(
      usage,
      resolvedPricing.priceData,
      buildCostCalculationOptions(
        provider.costMultiplier,
        session.getContext1mApplied(),
        priorityServiceTierApplied,
        longContextPricing,
        session.getGroupCostMultiplier()
      )
    );
    if (cost.lte(0)) return;

    const costFloat = parseFloat(cost.toString());

    // 追踪到 Redis（使用 session.sessionId）
    await RateLimitService.trackCost(
      key.id,
      provider.id,
      session.sessionId, // 直接使用 session.sessionId
      costFloat,
      {
        userId: user.id,
        key5hResetMode: key.limit5hResetMode,
        keyResetTime: key.dailyResetTime,
        keyResetMode: key.dailyResetMode,
        provider5hResetMode: provider.limit5hResetMode,
        providerResetTime: provider.dailyResetTime,
        providerResetMode: provider.dailyResetMode,
        user5hResetMode: user.limit5hResetMode,
        requestId: messageContext.id,
        createdAtMs: messageContext.createdAt.getTime(),
      }
    );

    // 新增：追踪用户层每日消费
    await RateLimitService.trackUserDailyCost(
      user.id,
      costFloat,
      user.dailyResetTime,
      user.dailyResetMode,
      {
        requestId: messageContext.id,
        createdAtMs: messageContext.createdAt.getTime(),
      }
    );

    // Decrement lease budgets for all windows (fire-and-forget)
    void Promise.all([
      RateLimitService.decrementLeaseBudget(key.id, "key", "5h", costFloat, {
        resetMode: key.limit5hResetMode,
      }),
      RateLimitService.decrementLeaseBudget(key.id, "key", "daily", costFloat, {
        resetMode: key.dailyResetMode,
      }),
      RateLimitService.decrementLeaseBudget(key.id, "key", "weekly", costFloat),
      RateLimitService.decrementLeaseBudget(key.id, "key", "monthly", costFloat),
      RateLimitService.decrementLeaseBudget(user.id, "user", "5h", costFloat, {
        resetMode: user.limit5hResetMode,
      }),
      RateLimitService.decrementLeaseBudget(user.id, "user", "daily", costFloat, {
        resetMode: user.dailyResetMode,
      }),
      RateLimitService.decrementLeaseBudget(user.id, "user", "weekly", costFloat),
      RateLimitService.decrementLeaseBudget(user.id, "user", "monthly", costFloat),
      RateLimitService.decrementLeaseBudget(provider.id, "provider", "5h", costFloat, {
        resetMode: provider.limit5hResetMode,
      }),
      RateLimitService.decrementLeaseBudget(provider.id, "provider", "daily", costFloat, {
        resetMode: provider.dailyResetMode,
      }),
      RateLimitService.decrementLeaseBudget(provider.id, "provider", "weekly", costFloat),
      RateLimitService.decrementLeaseBudget(provider.id, "provider", "monthly", costFloat),
    ]).catch((error) => {
      logger.warn("[ResponseHandler] Failed to decrement lease budgets:", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // 刷新 session 时间戳（滑动窗口）
    if (session.shouldTrackSessionObservability()) {
      void SessionTracker.refreshSession(session.sessionId, key.id, provider.id, user.id).catch(
        (error) => {
          logger.error("[ResponseHandler] Failed to refresh session tracker:", error);
        }
      );
    }
  } catch (error) {
    logger.error("[ResponseHandler] Failed to track cost to Redis, skipping", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 持久化请求失败信息到数据库
 * - 用于后台异步任务中的错误处理，确保 orphan records 被正确更新
 * - 包含完整的错误信息、duration、status code 和 provider chain
 */
async function persistRequestFailure(options: {
  session: ProxySession;
  messageContext: ProxySession["messageContext"] | null;
  statusCode: number;
  error: unknown;
  taskId: string;
  phase: "stream" | "non-stream";
}): Promise<void> {
  const { session, messageContext, statusCode, error, taskId, phase } = options;

  if (!messageContext) {
    logger.warn("ResponseHandler: Cannot persist failure without messageContext", {
      taskId,
      phase,
    });
    return;
  }

  const tracker = ProxyStatusTracker.getInstance();
  const errorMessage = formatProcessingError(error);
  const duration = Date.now() - session.startTime;

  // 提取完整错误信息用于排查（限制长度防止异常大的错误信息）
  const MAX_ERROR_STACK_LENGTH = 8192; // 8KB，足够容纳大多数堆栈信息
  const MAX_ERROR_CAUSE_LENGTH = 4096; // 4KB，足够容纳 JSON 序列化的错误原因

  let errorStack = error instanceof Error ? error.stack : undefined;
  if (errorStack && errorStack.length > MAX_ERROR_STACK_LENGTH) {
    errorStack = `${errorStack.substring(0, MAX_ERROR_STACK_LENGTH)}\n...[truncated]`;
  }

  let errorCause: string | undefined;
  if (error instanceof Error && (error as NodeJS.ErrnoException).cause) {
    try {
      // 序列化错误原因链，保留所有属性
      const cause = (error as NodeJS.ErrnoException).cause;
      errorCause = JSON.stringify(cause, Object.getOwnPropertyNames(cause as object));
    } catch {
      // 如果序列化失败，使用简单字符串
      errorCause = String((error as NodeJS.ErrnoException).cause);
    }
    // 截断过长的错误原因
    if (errorCause && errorCause.length > MAX_ERROR_CAUSE_LENGTH) {
      errorCause = `${errorCause.substring(0, MAX_ERROR_CAUSE_LENGTH)}...[truncated]`;
    }
  }

  try {
    // 更新请求持续时间
    await updateMessageRequestDuration(messageContext.id, duration);

    // 更新错误详情和 provider chain
    await updateMessageRequestDetails(messageContext.id, {
      statusCode,
      errorMessage,
      errorStack,
      errorCause,
      ttfbMs: phase === "non-stream" ? (session.ttfbMs ?? duration) : session.ttfbMs,
      providerChain: session.getProviderChain(),
      model: session.getCurrentModel() ?? undefined,
      providerId: session.provider?.id, // 更新最终供应商ID（重试切换后）
      context1mApplied: session.getContext1mApplied(),
      swapCacheTtlApplied: session.provider?.swapCacheTtlBilling ?? false,
      specialSettings: session.getSpecialSettings() ?? undefined,
    });

    if (session.sessionId && session.requestSequence != null) {
      if (session.shouldTrackSessionObservability()) {
        void deleteLiveChain(session.sessionId, session.requestSequence);
      }
    }

    const isAsyncWrite = getEnvConfig().MESSAGE_REQUEST_WRITE_MODE !== "sync";
    logger.info(
      isAsyncWrite
        ? "ResponseHandler: Request failure persistence enqueued"
        : "ResponseHandler: Successfully persisted request failure",
      {
        taskId,
        phase,
        messageId: messageContext.id,
        duration,
        statusCode,
        errorMessage,
      }
    );
  } catch (dbError) {
    logger.error("ResponseHandler: Failed to persist request failure", {
      taskId,
      phase,
      messageId: messageContext.id,
      error: errorMessage,
      dbError,
    });
  } finally {
    // 确保无论数据库操作成功与否，都清理追踪状态
    try {
      tracker.endRequest(messageContext.user.id, messageContext.id);
    } catch (trackerError) {
      logger.warn("ResponseHandler: Failed to end request tracking", {
        taskId,
        messageId: messageContext.id,
        trackerError,
      });
    }
  }

  // Emit Langfuse trace for error/abort paths
  emitLangfuseTrace(session, {
    responseHeaders: new Headers(),
    responseText: "",
    usageMetrics: null,
    costUsd: undefined,
    statusCode,
    durationMs: duration,
    isStreaming: phase === "stream",
    errorMessage,
  });
}

/**
 * 格式化处理错误信息
 * - 提取有意义的错误描述用于数据库存储
 */
function formatProcessingError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message?.trim();
    return message ? `${error.name}: ${message}` : error.name;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
