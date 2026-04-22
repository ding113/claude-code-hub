import { STATUS_CODES } from "node:http";
import type { Readable } from "node:stream";
import { createGunzip, constants as zlibConstants } from "node:zlib";
import type { Dispatcher } from "undici";
import { request as undiciRequest } from "undici";
import { applyAnthropicProviderOverridesWithAudit } from "@/lib/anthropic/provider-overrides";
import {
  getCircuitState,
  getProviderHealthInfo,
  recordFailure,
  recordSuccess,
} from "@/lib/circuit-breaker";
import {
  hasUsableClaudeMetadataUserId,
  injectClaudeMetadataUserIdWithContext,
} from "@/lib/claude-code/metadata-user-id";
import { applyCodexProviderOverridesWithAudit } from "@/lib/codex/provider-overrides";
import { getCachedSystemSettings, isHttp2Enabled } from "@/lib/config";
import { getEnvConfig } from "@/lib/config/env.schema";
import { PROVIDER_DEFAULTS, PROVIDER_LIMITS } from "@/lib/constants/provider.constants";
import { recordEndpointFailure, recordEndpointSuccess } from "@/lib/endpoint-circuit-breaker";
import { applyGeminiGoogleSearchOverrideWithAudit } from "@/lib/gemini/provider-overrides";
import { logger } from "@/lib/logger";
import {
  getEndpointFilterStats,
  getPreferredProviderEndpoints,
} from "@/lib/provider-endpoints/endpoint-selector";
import { getGlobalAgentPool, getProxyAgentForProvider } from "@/lib/proxy-agent";
import { SessionManager } from "@/lib/session-manager";
import {
  detectUpstreamErrorFromSseOrJsonText,
  inferUpstreamErrorStatusCodeFromText,
} from "@/lib/utils/upstream-error-detection";
import {
  isVendorTypeCircuitOpen,
  recordVendorTypeAllEndpointsTimeout,
} from "@/lib/vendor-type-circuit-breaker";
import { updateMessageRequestDetails } from "@/repository/message";
import type { CacheTtlPreference, CacheTtlResolved } from "@/types/cache";
import type { ProviderChainItem } from "@/types/message";
import type { Provider } from "@/types/provider";
import type {
  ClaudeMetadataUserIdInjectionSpecialSetting,
  SpecialSetting,
} from "@/types/special-settings";

import { GeminiAuth } from "../gemini/auth";
import { GEMINI_PROTOCOL } from "../gemini/protocol";
import { HeaderProcessor, resolveAnthropicAuthHeaders } from "../headers";
import { buildProxyUrl } from "../url";
import { rectifyBillingHeader } from "./billing-header-rectifier";
import { isStandardProxyEndpointPath } from "./endpoint-family-catalog";
import { isStrictStandardEndpointPath } from "./endpoint-paths";
import {
  buildRequestDetails,
  categorizeErrorAsync,
  EmptyResponseError,
  ErrorCategory,
  getErrorDetectionResultAsync,
  isClientAbortError,
  isEmptyResponseError,
  isHttp2Error,
  isSSLCertificateError,
  ProxyError,
  sanitizeUrl,
} from "./errors";
import { ModelRedirector } from "./model-redirector";
import {
  cloneOpenAIImageRequestMetadata,
  sanitizeGenerationsRequestForProvider,
  serializeOpenAIImageMultipartRequest,
  syncOpenAIImageMultipartFromLogicalBody,
  validateOpenAIImageRequest,
} from "./openai-image-compat";
import { ProxyProviderResolver } from "./provider-selector";
import type { ProxySession } from "./session";
import { setDeferredStreamingFinalization } from "./stream-finalization";
import {
  detectThinkingBudgetRectifierTrigger,
  rectifyThinkingBudget,
} from "./thinking-budget-rectifier";
import {
  detectThinkingSignatureRectifierTrigger,
  rectifyAnthropicRequestMessage,
} from "./thinking-signature-rectifier";

/** Default User-Agent for Codex CLI requests when none is provided */
export const DEFAULT_CODEX_USER_AGENT =
  "codex_cli_rs/0.93.0 (Windows 10.0.26200; x86_64) vscode/1.108.1";

const OUTBOUND_TRANSPORT_HEADER_BLACKLIST = ["content-length", "connection", "transfer-encoding"];

const RETRY_LIMITS = PROVIDER_LIMITS.MAX_RETRY_ATTEMPTS;
const MAX_PROVIDER_SWITCHES = 20; // 保险栓：最多切换 20 次供应商（防止无限循环）

type CacheTtlOption = CacheTtlPreference | null | undefined;

type ProxySessionWithAttemptRuntime = ProxySession & {
  clearResponseTimeout?: () => void;
  responseController?: AbortController;
};

type StreamingHedgeAttempt = {
  provider: Provider;
  session: ProxySession;
  baseUrl: string;
  endpointAudit: { endpointId: number | null; endpointUrl: string };
  modelRedirect?: ProviderChainItem["modelRedirect"];
  responseController: AbortController | null;
  clearResponseTimeout: (() => void) | null;
  firstByteTimeoutMs: number;
  sequence: number;
  requestAttemptCount: number;
  reactiveRectifierRetryState: ReactiveRectifierRetryState;
  settled: boolean;
  thresholdTriggered: boolean;
  thresholdTimer: NodeJS.Timeout | null;
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  response: Response | null;
};

type ReactiveRectifierRetryState = {
  thinkingSignatureRetried: boolean;
  thinkingBudgetRetried: boolean;
};

type ReactiveRectifierResult =
  | { matched: false }
  | {
      matched: true;
      applied: false;
      reason: "already_retried" | "not_applicable";
      rectifierType: "thinking_signature_rectifier" | "thinking_budget_rectifier";
      trigger: string;
    }
  | {
      matched: true;
      applied: true;
      rectifierType: "thinking_signature_rectifier" | "thinking_budget_rectifier";
      trigger: string;
      requestDetailsBeforeRectify: ReturnType<typeof buildRequestDetails>;
    };

type DetailRequestAfterSnapshot = {
  body: string | null;
  headers: Headers;
  meta: {
    clientUrl: null;
    upstreamUrl: string;
    method: string;
  };
};

type DetailResponseBeforeSnapshot = {
  headers: Headers;
  meta: {
    upstreamUrl: string;
    statusCode: number;
  };
};

type ProxySessionWithDetailSnapshotRuntime = ProxySession & {
  detailSnapshotRequestAfter?: DetailRequestAfterSnapshot | null;
  detailSnapshotResponseBefore?: DetailResponseBeforeSnapshot | null;
};

// 非流式响应体检查的上限（字节）：避免上游在 2xx 场景返回超大内容导致内存占用失控。
// 说明：
// - 该检查仅用于“空响应/假 200”启发式判定，不用于业务逻辑解析；
// - 超过上限时，仍认为“非空”，但会跳过 JSON 内容结构检查（避免截断导致误判）。
const NON_STREAM_BODY_INSPECTION_MAX_BYTES = 32 * 1024; // 32 KiB

/**
 * 读取响应体文本，但最多读取 `maxBytes` 字节（用于非流式 2xx 的“空响应/假 200”嗅探）。
 *
 * 注意：
 * - 该函数只用于启发式检测，不用于业务逻辑解析；
 * - 超过上限时会 fire-and-forget `cancel()` reader，避免继续占用资源；
 * - cancel() 不使用 await，因为对 tee 分支的 cancel 在推模式大流下可能长时间阻塞；
 * - 调用方应使用 `response.clone()`，避免消费掉原始响应体，影响后续透传/解析。
 */
async function readResponseTextUpTo(
  response: Response,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { text: "", truncated: false };
  }

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      const remaining = maxBytes - bytesRead;
      // 注意：remaining<=0 发生在“已经读到下一块 chunk”之后。
      // 对启发式嗅探而言，直接标记 truncated 并退出即可（等价于丢弃超出上限的后续字节），
      // 避免对超出部分做无谓的解码开销。
      if (remaining <= 0) {
        truncated = true;
        break;
      }

      if (value.byteLength > remaining) {
        chunks.push(decoder.decode(value.subarray(0, remaining), { stream: true }));
        bytesRead += remaining;
        truncated = true;
        break;
      }

      chunks.push(decoder.decode(value, { stream: true }));
      bytesRead += value.byteLength;
    }

    const flushed = decoder.decode();
    if (flushed) chunks.push(flushed);
  } finally {
    if (truncated) {
      // Fire-and-forget: do NOT await reader.cancel() here.
      // On tee'd ReadableStreams backed by push-mode Node streams (e.g. large chunked
      // responses via nodeStreamToWebStreamSafe), await cancel() can block indefinitely
      // because the tee controller waits for internal queue drainage while the other
      // branch has not started consuming yet. This deadlocks the main request path.
      reader.cancel().catch((cancelErr) => {
        logger.debug("readResponseTextUpTo: failed to cancel reader", { error: cancelErr });
      });
    }

    try {
      reader.releaseLock();
    } catch (releaseErr) {
      logger.debug("readResponseTextUpTo: failed to release reader lock", { error: releaseErr });
    }
  }

  return { text: chunks.join(""), truncated };
}

function resolveCacheTtlPreference(
  keyPref: CacheTtlOption,
  providerPref: CacheTtlOption
): CacheTtlResolved | null {
  const normalize = (value: CacheTtlOption): CacheTtlResolved | null => {
    if (!value || value === "inherit") return null;
    return value;
  };

  return normalize(keyPref) ?? normalize(providerPref) ?? null;
}

function applyCacheTtlOverrideToMessage(
  message: Record<string, unknown>,
  ttl: CacheTtlResolved
): boolean {
  let applied = false;
  const messages = (message as Record<string, unknown>).messages;

  if (!Array.isArray(messages)) {
    return applied;
  }

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const msgObj = msg as Record<string, unknown>;
    const content = msgObj.content;

    if (!Array.isArray(content)) continue;

    msgObj.content = content.map((item) => {
      if (!item || typeof item !== "object") return item;
      const itemObj = item as Record<string, unknown>;
      const cacheControl = itemObj.cache_control;

      if (cacheControl && typeof cacheControl === "object") {
        const ccObj = cacheControl as Record<string, unknown>;
        if (ccObj.type === "ephemeral") {
          applied = true;
          return {
            ...itemObj,
            cache_control: {
              ...ccObj,
              ttl: ttl === "1h" ? "1h" : "5m",
            },
          };
        }
      }
      return item;
    });
  }

  return applied;
}

function clampRetryAttempts(value: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return RETRY_LIMITS.MIN;
  return Math.min(Math.max(numeric, RETRY_LIMITS.MIN), RETRY_LIMITS.MAX);
}

function resolveMaxAttemptsForProvider(
  provider: ProxySession["provider"],
  envDefault: number
): number {
  const baseDefault = clampRetryAttempts(envDefault ?? PROVIDER_DEFAULTS.MAX_RETRY_ATTEMPTS);
  if (!provider || provider.maxRetryAttempts === null || provider.maxRetryAttempts === undefined) {
    return baseDefault;
  }
  return clampRetryAttempts(provider.maxRetryAttempts);
}

function buildEndpointAttemptKey(endpointId: number | null, endpointUrl: string): string {
  return endpointId != null ? `id:${endpointId}` : `url:${endpointUrl}`;
}

/**
 * undici request 超时配置（毫秒）
 *
 * 背景：undiciRequest() 在使用自定义 dispatcher（如 SOCKS 代理）时，
 * 不会继承全局 Agent 的超时配置，需要显式传递超时参数。
 *
 * 这里与全局 undici Agent 使用同一套环境变量配置（FETCH_HEADERS_TIMEOUT / FETCH_BODY_TIMEOUT）。
 */
// 注意：undici.request 的 headersTimeout/bodyTimeout 属于 RequestOptions；
// connectTimeout 属于 Dispatcher/Client 配置（已在全局 Agent / ProxyAgent 里处理）。

/**
 * 过滤私有参数（下划线前缀）
 *
 * 目的：防止私有参数（下划线前缀）泄露到上游供应商导致 "Unsupported parameter" 错误
 *
 * @param obj - 原始请求对象
 * @returns 过滤后的请求对象
 */
function filterPrivateParameters(obj: unknown): unknown {
  // 非对象类型直接返回
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }

  // 数组类型递归处理
  if (Array.isArray(obj)) {
    return obj.map((item) => filterPrivateParameters(item));
  }

  // 对象类型：过滤下划线前缀的键
  const filtered: Record<string, unknown> = {};
  const removedKeys: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("_")) {
      // 私有参数：跳过
      removedKeys.push(key);
    } else {
      // 公开参数：递归过滤值
      filtered[key] = filterPrivateParameters(value);
    }
  }

  // 记录被过滤的参数（debug 级别）
  if (removedKeys.length > 0) {
    logger.debug("[ProxyForwarder] Filtered private parameters from request", {
      removedKeys,
      reason: "Private parameters (underscore-prefixed) should not be sent to upstream providers",
    });
  }

  return filtered;
}

type ClaudeMetadataUserIdInjectionResult = {
  message: Record<string, unknown>;
  audit: ClaudeMetadataUserIdInjectionSpecialSetting;
};

async function persistSpecialSettings(session: ProxySession): Promise<void> {
  const specialSettings = session.getSpecialSettings();
  if (!specialSettings || specialSettings.length === 0) {
    return;
  }

  if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
    await SessionManager.storeSessionSpecialSettings(
      session.sessionId,
      specialSettings,
      session.requestSequence
    ).catch((err) => {
      logger.error("[ProxyForwarder] Failed to store special settings", {
        error: err,
        sessionId: session.sessionId,
      });
    });
  }

  if (session.messageContext?.id) {
    await updateMessageRequestDetails(session.messageContext.id, {
      specialSettings,
    }).catch((err) => {
      logger.error("[ProxyForwarder] Failed to persist special settings", {
        error: err,
        messageRequestId: session.messageContext?.id,
      });
    });
  }
}

function addSpecialSettingForPersistence(
  ownerSession: ProxySession,
  persistSession: ProxySession,
  setting: SpecialSetting
): void {
  ownerSession.addSpecialSetting(setting);
  if (persistSession !== ownerSession) {
    persistSession.addSpecialSetting(setting);
  }
}

async function persistRequestAfterSnapshot(
  session: ProxySession,
  snapshot: DetailRequestAfterSnapshot | null | undefined
): Promise<void> {
  if (!snapshot || !session.sessionId || !session.shouldPersistSessionDebugArtifacts()) {
    return;
  }

  await SessionManager.storeSessionRequestPhaseSnapshot(
    session.sessionId,
    "after",
    {
      body: snapshot.body,
      headers: snapshot.headers,
      meta: snapshot.meta,
    },
    session.requestSequence
  ).catch((err) => {
    logger.error("Failed to store request after snapshot:", err);
  });
}

async function persistResponseBeforeSnapshot(
  session: ProxySession,
  snapshot: DetailResponseBeforeSnapshot | null | undefined
): Promise<void> {
  if (!snapshot || !session.sessionId || !session.shouldPersistSessionDebugArtifacts()) {
    return;
  }

  await SessionManager.storeSessionResponsePhaseSnapshot(
    session.sessionId,
    "before",
    {
      headers: snapshot.headers,
      meta: snapshot.meta,
    },
    session.requestSequence
  ).catch((err) => {
    logger.error("Failed to store response before snapshot meta:", err);
  });
}

type MatchedRuleDetails = NonNullable<
  NonNullable<ProviderChainItem["errorDetails"]>["matchedRule"]
>;

function buildMatchedRuleDetails(
  detectionResult: Awaited<ReturnType<typeof getErrorDetectionResultAsync>>
): MatchedRuleDetails | undefined {
  if (
    !detectionResult.matched ||
    detectionResult.ruleId === undefined ||
    detectionResult.pattern === undefined ||
    detectionResult.matchType === undefined ||
    detectionResult.category === undefined
  ) {
    return undefined;
  }

  return {
    ruleId: detectionResult.ruleId,
    pattern: detectionResult.pattern,
    matchType: detectionResult.matchType,
    category: detectionResult.category,
    description: detectionResult.description,
    hasOverrideResponse: detectionResult.overrideResponse !== undefined,
    hasOverrideStatusCode: detectionResult.overrideStatusCode !== undefined,
  };
}

function buildMatchedRuleLogContext(
  matchedRule: MatchedRuleDetails | undefined
): Record<string, unknown> {
  if (!matchedRule) {
    return {};
  }

  return {
    matchedRuleId: matchedRule.ruleId,
    matchedRuleName: matchedRule.description?.trim() || matchedRule.pattern,
    matchedRulePattern: matchedRule.pattern,
    matchedRuleCategory: matchedRule.category,
    matchedRuleMatchType: matchedRule.matchType,
    matchedRuleHasOverrideResponse: matchedRule.hasOverrideResponse,
    matchedRuleHasOverrideStatusCode: matchedRule.hasOverrideStatusCode,
  };
}

function buildClientErrorChainEntry(
  provider: Provider,
  endpointAudit: { endpointId: number | null; endpointUrl: string },
  attemptNumber: number,
  error: Error,
  errorMessage: string,
  requestDetails: ReturnType<typeof buildRequestDetails>,
  matchedRule: MatchedRuleDetails | undefined
): NonNullable<Parameters<ProxySession["addProviderToChain"]>[1]> {
  if (error instanceof ProxyError) {
    return {
      ...endpointAudit,
      reason: "client_error_non_retryable",
      circuitState: getCircuitState(provider.id),
      attemptNumber,
      errorMessage,
      statusCode: error.statusCode,
      statusCodeInferred: error.upstreamError?.statusCodeInferred ?? false,
      errorDetails: {
        provider: {
          id: provider.id,
          name: provider.name,
          statusCode: error.statusCode,
          statusText: error.message,
          upstreamBody: error.upstreamError?.body,
          upstreamParsed: error.upstreamError?.parsed,
        },
        clientError: error.getDetailedErrorMessage(),
        matchedRule,
        request: requestDetails,
      },
    };
  }

  return {
    ...endpointAudit,
    reason: "client_error_non_retryable",
    circuitState: getCircuitState(provider.id),
    attemptNumber,
    errorMessage,
    errorDetails: {
      clientError: error.message,
      matchedRule,
      request: requestDetails,
    },
  };
}

function buildRetryFailedChainEntry(
  provider: Provider,
  endpointAudit: { endpointId: number | null; endpointUrl: string },
  attemptNumber: number,
  error: Error,
  errorMessage: string,
  requestDetailsBeforeRectify: ReturnType<typeof buildRequestDetails>
): NonNullable<Parameters<ProxySession["addProviderToChain"]>[1]> {
  if (error instanceof ProxyError) {
    return {
      ...endpointAudit,
      reason: "retry_failed",
      circuitState: getCircuitState(provider.id),
      attemptNumber,
      errorMessage,
      statusCode: error.statusCode,
      statusCodeInferred: error.upstreamError?.statusCodeInferred ?? false,
      errorDetails: {
        provider: {
          id: provider.id,
          name: provider.name,
          statusCode: error.statusCode,
          statusText: error.message,
          upstreamBody: error.upstreamError?.body,
          upstreamParsed: error.upstreamError?.parsed,
        },
        request: requestDetailsBeforeRectify,
      },
    };
  }

  return {
    ...endpointAudit,
    reason: "retry_failed",
    circuitState: getCircuitState(provider.id),
    attemptNumber,
    errorMessage,
    errorDetails: {
      system: {
        errorType: error.constructor.name,
        errorName: error.name,
        errorMessage: error.message || error.name || "Unknown error",
        errorStack: error.stack?.split("\n").slice(0, 3).join("\n"),
      },
      request: requestDetailsBeforeRectify,
    },
  };
}

function getReactiveRectifierDisplayName(
  rectifierType: "thinking_signature_rectifier" | "thinking_budget_rectifier"
): string {
  return rectifierType === "thinking_signature_rectifier"
    ? "Thinking signature rectifier"
    : "Thinking budget rectifier";
}

async function tryApplyReactiveAnthropicRectifier(params: {
  provider: Provider;
  requestSession: ProxySession;
  persistSession: ProxySession;
  errorMessage: string;
  attemptNumber: number;
  retryAttemptNumber: number;
  retryState: ReactiveRectifierRetryState;
}): Promise<ReactiveRectifierResult> {
  const {
    provider,
    requestSession,
    persistSession,
    errorMessage,
    attemptNumber,
    retryAttemptNumber,
  } = params;
  const isAnthropicProvider =
    provider.providerType === "claude" || provider.providerType === "claude-auth";

  if (!isAnthropicProvider) {
    return { matched: false };
  }

  const signatureTrigger = detectThinkingSignatureRectifierTrigger(errorMessage);
  if (signatureTrigger) {
    const settings = await getCachedSystemSettings();
    const enabled = settings.enableThinkingSignatureRectifier ?? true;

    if (!enabled) {
      return { matched: false };
    }

    if (params.retryState.thinkingSignatureRetried) {
      return {
        matched: true,
        applied: false,
        reason: "already_retried",
        rectifierType: "thinking_signature_rectifier",
        trigger: signatureTrigger,
      };
    }

    const requestDetailsBeforeRectify = buildRequestDetails(requestSession);
    const rectified = rectifyAnthropicRequestMessage(
      requestSession.request.message as Record<string, unknown>
    );

    addSpecialSettingForPersistence(requestSession, persistSession, {
      type: "thinking_signature_rectifier",
      scope: "request",
      hit: rectified.applied,
      providerId: provider.id,
      providerName: provider.name,
      trigger: signatureTrigger,
      attemptNumber,
      retryAttemptNumber,
      removedThinkingBlocks: rectified.removedThinkingBlocks,
      removedRedactedThinkingBlocks: rectified.removedRedactedThinkingBlocks,
      removedSignatureFields: rectified.removedSignatureFields,
    });
    await persistSpecialSettings(persistSession);

    if (!rectified.applied) {
      return {
        matched: true,
        applied: false,
        reason: "not_applicable",
        rectifierType: "thinking_signature_rectifier",
        trigger: signatureTrigger,
      };
    }

    params.retryState.thinkingSignatureRetried = true;
    return {
      matched: true,
      applied: true,
      rectifierType: "thinking_signature_rectifier",
      trigger: signatureTrigger,
      requestDetailsBeforeRectify,
    };
  }

  const budgetTrigger = detectThinkingBudgetRectifierTrigger(errorMessage);
  if (!budgetTrigger) {
    return { matched: false };
  }

  const settings = await getCachedSystemSettings();
  const enabled = settings.enableThinkingBudgetRectifier ?? true;

  if (!enabled) {
    return { matched: false };
  }

  if (params.retryState.thinkingBudgetRetried) {
    return {
      matched: true,
      applied: false,
      reason: "already_retried",
      rectifierType: "thinking_budget_rectifier",
      trigger: budgetTrigger,
    };
  }

  const requestDetailsBeforeRectify = buildRequestDetails(requestSession);
  const rectified = rectifyThinkingBudget(
    requestSession.request.message as Record<string, unknown>
  );

  addSpecialSettingForPersistence(requestSession, persistSession, {
    type: "thinking_budget_rectifier",
    scope: "request",
    hit: rectified.applied,
    providerId: provider.id,
    providerName: provider.name,
    trigger: budgetTrigger,
    attemptNumber,
    retryAttemptNumber,
    before: rectified.before,
    after: rectified.after,
  });
  await persistSpecialSettings(persistSession);

  if (!rectified.applied) {
    return {
      matched: true,
      applied: false,
      reason: "not_applicable",
      rectifierType: "thinking_budget_rectifier",
      trigger: budgetTrigger,
    };
  }

  params.retryState.thinkingBudgetRetried = true;
  return {
    matched: true,
    applied: true,
    rectifierType: "thinking_budget_rectifier",
    trigger: budgetTrigger,
    requestDetailsBeforeRectify,
  };
}

/**
 * 为 Claude 请求注入 metadata.user_id
 *
 * 格式选择：
 * - Claude Code < v2.1.78: `user_{stableHash}_account__session_{sessionId}`
 * - 无法识别版本 / >= v2.1.78: JSON 字符串 `{"device_id":"...","account_uuid":"","session_id":"..."}`
 *
 * 注意：如果请求体中已存在 metadata.user_id，则保持原样不修改
 * @internal
 */
export function injectClaudeMetadataUserId(
  message: Record<string, unknown>,
  session: ProxySession
): Record<string, unknown> {
  const keyId = session.authState?.key?.id;
  const sessionId = session.sessionId;

  return injectClaudeMetadataUserIdWithContext(message, {
    keyId,
    sessionId,
    userAgent: session.userAgent,
  });
}

function applyClaudeMetadataUserIdInjectionWithAudit(
  message: Record<string, unknown>,
  session: ProxySession,
  enabled: boolean
): ClaudeMetadataUserIdInjectionResult | null {
  const keyId = session.authState?.key?.id ?? null;
  const sessionId = session.sessionId ?? null;

  if (!enabled) {
    logger.info("[ProxyForwarder] Claude metadata.user_id injection skipped", {
      enabled,
      hit: false,
      reason: "disabled",
      keyId,
      sessionId,
    });
    return null;
  }

  const existingMetadata =
    typeof message.metadata === "object" && message.metadata !== null
      ? (message.metadata as Record<string, unknown>)
      : undefined;

  if (hasUsableClaudeMetadataUserId(existingMetadata?.user_id)) {
    logger.info("[ProxyForwarder] Claude metadata.user_id injection skipped", {
      enabled,
      hit: false,
      reason: "already_exists",
      keyId,
      sessionId,
    });

    return {
      message,
      audit: {
        type: "claude_metadata_user_id_injection",
        scope: "request",
        hit: false,
        action: "skipped",
        reason: "already_exists",
        keyId,
        sessionId,
      },
    };
  }

  if (keyId == null) {
    logger.info("[ProxyForwarder] Claude metadata.user_id injection skipped", {
      enabled,
      hit: false,
      reason: "missing_key_id",
      keyId,
      sessionId,
    });

    return {
      message,
      audit: {
        type: "claude_metadata_user_id_injection",
        scope: "request",
        hit: false,
        action: "skipped",
        reason: "missing_key_id",
        keyId,
        sessionId,
      },
    };
  }

  if (!sessionId) {
    logger.info("[ProxyForwarder] Claude metadata.user_id injection skipped", {
      enabled,
      hit: false,
      reason: "missing_session_id",
      keyId,
      sessionId,
    });

    return {
      message,
      audit: {
        type: "claude_metadata_user_id_injection",
        scope: "request",
        hit: false,
        action: "skipped",
        reason: "missing_session_id",
        keyId,
        sessionId,
      },
    };
  }

  const injectedMessage = injectClaudeMetadataUserId(message, session);

  logger.info("[ProxyForwarder] Claude metadata.user_id injection applied", {
    enabled,
    hit: true,
    reason: "injected",
    keyId,
    sessionId,
  });

  return {
    message: injectedMessage,
    audit: {
      type: "claude_metadata_user_id_injection",
      scope: "request",
      hit: true,
      action: "injected",
      reason: "injected",
      keyId,
      sessionId,
    },
  };
}

export class ProxyForwarder {
  static async send(session: ProxySession): Promise<Response> {
    if (!session.provider || !session.authState?.success) {
      throw new Error("代理上下文缺少供应商或鉴权信息");
    }

    if (ProxyForwarder.shouldUseStreamingHedge(session)) {
      const hedgePromise = ProxyForwarder.sendStreamingWithHedge(session);
      void hedgePromise.catch(() => undefined);
      return await hedgePromise;
    }

    const env = getEnvConfig();
    const envDefaultMaxAttempts = clampRetryAttempts(env.MAX_RETRY_ATTEMPTS_DEFAULT);

    let lastError: Error | null = null;
    let currentProvider = session.provider;
    const failedProviderIds: number[] = []; // 记录已失败的供应商ID
    let totalProvidersAttempted = 0; // 已尝试的供应商数量（用于日志）

    // ========== 外层循环：供应商切换（最多 MAX_PROVIDER_SWITCHES 次）==========
    while (totalProvidersAttempted < MAX_PROVIDER_SWITCHES) {
      totalProvidersAttempted++;
      let attemptCount = 0; // 当前供应商的尝试次数

      let maxAttemptsPerProvider = resolveMaxAttemptsForProvider(
        currentProvider,
        envDefaultMaxAttempts
      );
      const reactiveRectifierRetryState: ReactiveRectifierRetryState = {
        thinkingSignatureRetried: false,
        thinkingBudgetRetried: false,
      };

      const requestPath = session.requestUrl.pathname;
      const providerVendorId = currentProvider.providerVendorId ?? 0;
      const isMcpRequest =
        currentProvider.providerType !== "gemini" &&
        currentProvider.providerType !== "gemini-cli" &&
        !isStandardProxyEndpointPath(requestPath);
      const shouldEnforceStrictEndpointPool =
        !isMcpRequest && isStrictStandardEndpointPath(requestPath) && providerVendorId > 0;
      let endpointSelectionError: Error | null = null;

      const endpointCandidates: Array<{ endpointId: number | null; baseUrl: string }> = [];

      if (isMcpRequest) {
        endpointCandidates.push({ endpointId: null, baseUrl: currentProvider.url });
      } else if (providerVendorId > 0) {
        try {
          const preferred = await getPreferredProviderEndpoints({
            vendorId: providerVendorId,
            providerType: currentProvider.providerType,
          });
          endpointCandidates.push(...preferred.map((e) => ({ endpointId: e.id, baseUrl: e.url })));
        } catch (error) {
          endpointSelectionError =
            error instanceof Error
              ? error
              : new Error(typeof error === "string" ? error : String(error));
          logger.warn("[ProxyForwarder] Failed to load provider endpoints", {
            providerId: currentProvider.id,
            vendorId: providerVendorId,
            providerType: currentProvider.providerType,
            error: endpointSelectionError.message,
            strictEndpointPolicy: shouldEnforceStrictEndpointPool,
            reason: "selector_error",
          });
        }
      }

      if (endpointCandidates.length === 0) {
        if (shouldEnforceStrictEndpointPool) {
          const strictBlockCause = endpointSelectionError
            ? "selector_error"
            : "no_endpoint_candidates";

          logger.warn(
            "ProxyForwarder: Strict endpoint policy blocked legacy provider.url fallback",
            {
              providerId: currentProvider.id,
              vendorId: providerVendorId,
              providerType: currentProvider.providerType,
              requestPath,
              reason: "strict_blocked_legacy_fallback",
              strictBlockCause,
              selectorError: endpointSelectionError?.message,
            }
          );

          // Record endpoint pool exhaustion in provider chain for audit trail
          const exhaustionContext: Record<string, unknown> = { strictBlockCause };
          if (endpointSelectionError) {
            exhaustionContext.selectorError = endpointSelectionError.message;
          }

          // Collect endpoint filter stats for no_endpoint_candidates (selector_error has no data)
          let filterStats: ProviderChainItem["endpointFilterStats"];
          if (!endpointSelectionError) {
            try {
              const stats = await getEndpointFilterStats({
                vendorId: providerVendorId,
                providerType: currentProvider.providerType,
              });
              filterStats = stats;
            } catch (statsError) {
              logger.warn("[ProxyForwarder] Failed to collect endpoint filter stats", {
                providerId: currentProvider.id,
                vendorId: providerVendorId,
                error: statsError instanceof Error ? statsError.message : String(statsError),
              });
            }
          }

          session.addProviderToChain(currentProvider, {
            reason: "endpoint_pool_exhausted",
            strictBlockCause: strictBlockCause as ProviderChainItem["strictBlockCause"],
            // 为避免被 initial_selection/session_reuse 去重吞掉，这里需要写入 attemptNumber。
            // 同时也能让“决策链/技术时间线”把它当作一次实际尝试（虽然请求未发出）。
            attemptNumber: 1,
            ...(filterStats ? { endpointFilterStats: filterStats } : {}),
            errorMessage: endpointSelectionError?.message,
          });

          failedProviderIds.push(currentProvider.id);
          attemptCount = maxAttemptsPerProvider;
        } else {
          endpointCandidates.push({ endpointId: null, baseUrl: currentProvider.url });
        }
      }

      // Truncate endpoints to maxRetryAttempts count
      // Ensures only the N lowest-latency endpoints are used (N = maxRetryAttempts)
      // Note: getPreferredProviderEndpoints already returns endpoints sorted by latency (ascending)
      if (endpointCandidates.length > maxAttemptsPerProvider) {
        const originalCount = endpointCandidates.length;
        endpointCandidates.length = maxAttemptsPerProvider;

        logger.debug("ProxyForwarder: Truncated endpoint candidates to match maxRetryAttempts", {
          providerId: currentProvider.id,
          providerName: currentProvider.name,
          originalEndpointCount: originalCount,
          truncatedTo: maxAttemptsPerProvider,
          selectedEndpointIds: endpointCandidates.map((e) => e.endpointId),
        });
      }

      const endpointCandidateKeys = new Set(
        endpointCandidates.map((endpoint) =>
          buildEndpointAttemptKey(endpoint.endpointId, endpoint.baseUrl)
        )
      );
      const timedOutEndpointKeys = new Set<string>();

      // Endpoint stickiness: track current endpoint index separately from attemptCount
      // - SYSTEM_ERROR (network error): advance to next endpoint
      // - PROVIDER_ERROR (HTTP error): stay at current endpoint
      // - No wrap-around: if exhausted, stay at last endpoint
      let currentEndpointIndex = 0;

      logger.info("ProxyForwarder: Trying provider", {
        providerId: currentProvider.id,
        providerName: currentProvider.name,
        totalProvidersAttempted,
        maxRetryAttempts: maxAttemptsPerProvider,
        endpointCount: endpointCandidates.length,
        endpointSelectionCriteria: "latency_ascending",
        selectedEndpoints: endpointCandidates.map((e, idx) => ({
          index: idx,
          endpointId: e.endpointId,
          baseUrl: sanitizeUrl(e.baseUrl),
        })),
      });

      if (
        !isMcpRequest &&
        currentProvider.providerVendorId &&
        (await isVendorTypeCircuitOpen(
          currentProvider.providerVendorId,
          currentProvider.providerType
        ))
      ) {
        logger.warn("ProxyForwarder: Vendor-type circuit is open, skipping provider", {
          providerId: currentProvider.id,
          vendorId: currentProvider.providerVendorId,
          providerType: currentProvider.providerType,
        });
        failedProviderIds.push(currentProvider.id);
        attemptCount = maxAttemptsPerProvider;
      }

      // ========== 内层循环：重试当前供应商（根据配置最多尝试 maxAttemptsPerProvider 次）==========
      while (attemptCount < maxAttemptsPerProvider) {
        attemptCount++;

        // Use currentEndpointIndex for endpoint selection (sticky behavior)
        // - currentEndpointIndex is advanced only on SYSTEM_ERROR (network errors)
        // - PROVIDER_ERROR keeps the same endpoint (no advancement)
        // - No wrap-around: clamped to last endpoint if exhausted
        const endpointIndex =
          endpointCandidates.length > 0
            ? Math.min(currentEndpointIndex, endpointCandidates.length - 1)
            : 0;
        const activeEndpoint = endpointCandidates[endpointIndex];
        const endpointAudit = {
          endpointId: activeEndpoint.endpointId,
          endpointUrl: sanitizeUrl(activeEndpoint.baseUrl),
        };

        try {
          const response = await ProxyForwarder.doForward(
            session,
            currentProvider,
            activeEndpoint.baseUrl,
            endpointAudit,
            attemptCount
          );

          // ========== 空响应检测（仅非流式）==========
          const contentType = response.headers.get("content-type") || "";
          const normalizedContentType = contentType.toLowerCase();
          const isSSE = normalizedContentType.includes("text/event-stream");
          const isHtml =
            normalizedContentType.includes("text/html") ||
            normalizedContentType.includes("application/xhtml+xml");
          const isJson =
            normalizedContentType.includes("application/json") ||
            normalizedContentType.includes("+json");

          // ========== 流式响应：延迟成功判定（避免“假 200”）==========
          // 背景：上游可能返回 HTTP 200，但 SSE 内容为错误 JSON（如 {"error": "..."}）。
          // 如果在“收到响应头”时就立刻记录 success / 更新 session 绑定：
          // - 会把会话粘到一个实际不可用的 provider；
          // - 熔断/故障转移统计被误记为成功；
          // - 客户端下一次自动重试可能仍复用到同一 provider，导致“假 200”让重试失效。
          //
          // 解决：Forwarder 只负责尽快把 Response 返回给下游开始透传，
          // 把最终成功/失败结算延迟到 ResponseHandler：等 SSE 正常结束后再基于最终 body 补充检查并更新内部状态。
          if (isSSE) {
            setDeferredStreamingFinalization(session, {
              providerId: currentProvider.id,
              providerName: currentProvider.name,
              providerPriority: currentProvider.priority || 0,
              attemptNumber: attemptCount,
              totalProvidersAttempted,
              isFirstAttempt: totalProvidersAttempted === 1 && attemptCount === 1,
              isFailoverSuccess: totalProvidersAttempted > 1,
              endpointId: activeEndpoint.endpointId,
              endpointUrl: endpointAudit.endpointUrl,
              upstreamStatusCode: response.status,
            });

            logger.info("ProxyForwarder: Streaming response received, deferring finalization", {
              providerId: currentProvider.id,
              providerName: currentProvider.name,
              attemptNumber: attemptCount,
              totalProvidersAttempted,
              statusCode: response.status,
            });

            return response;
          }

          // 非流式响应：检测空响应
          const contentLengthHeader = response.headers.get("content-length");
          const contentLength = contentLengthHeader?.trim() || undefined;
          const contentLengthBytes = (() => {
            if (!contentLength) return null;

            // Content-Length 必须是纯数字；parseInt("12abc") 会返回 12，容易误判为合法值，
            // 从而跳过 “!hasValidContentLength” 的检查分支。
            if (!/^\d+$/.test(contentLength)) return null;

            const num = Number(contentLength);
            if (!Number.isSafeInteger(num) || num < 0) return null;
            return num;
          })();
          const hasValidContentLength = contentLengthBytes !== null;

          // 检测 Content-Length: 0 的情况
          if (contentLengthBytes === 0) {
            throw new EmptyResponseError(currentProvider.id, currentProvider.name, "empty_body");
          }

          // 200 + text/html（或 xhtml）通常是上游网关/WAF/Cloudflare 的错误页，但被包装成了 HTTP 200。
          // 这种“假 200”会导致：
          // - 熔断/故障转移统计被误记为成功；
          // - session 智能绑定被更新到不可用 provider（影响后续重试）。
          // 因此这里在进入成功分支前做一次强信号检测：仅当 body 看起来是完整 HTML 文档时才视为错误。
          let inspectedText: string | undefined;
          let inspectedTruncated = false;
          // 注意：这里不会对“大体积 JSON”做假 200 检测（例如 Content-Length > 32KiB）。
          // 原因：
          // - 非流式路径需要 clone 并额外读取响应体，会带来额外的内存/延迟开销；
          // - 大体积 JSON 更可能是正常响应（而不是网关/WAF 的短错误 JSON）。
          // 这意味着：极少数“超大 JSON 错误体 + HTTP 200”的上游异常可能会漏检。
          const shouldInspectJson =
            isJson &&
            hasValidContentLength &&
            contentLengthBytes <= NON_STREAM_BODY_INSPECTION_MAX_BYTES;
          const shouldInspectBody = isHtml || !hasValidContentLength || shouldInspectJson;
          if (shouldInspectBody) {
            // 注意：Response.clone() 会 tee 底层 ReadableStream，可能带来一定的瞬时内存开销；
            // 这里通过“最多读取 32 KiB”并在截断时 cancel 克隆分支来控制开销。
            const clonedResponse = response.clone();
            const inspected = await readResponseTextUpTo(
              clonedResponse,
              NON_STREAM_BODY_INSPECTION_MAX_BYTES
            );
            inspectedText = inspected.text;
            inspectedTruncated = inspected.truncated;
          }

          if (inspectedText !== undefined) {
            // 对非流式 2xx 响应：只启用“强信号”判定（HTML 文档 / 顶层 error 非空 / 空 body）。
            // `message` 关键字匹配属于弱信号，误判风险更高；该规则主要用于 SSE 结束后的补充检测。
            const detected = detectUpstreamErrorFromSseOrJsonText(inspectedText, {
              maxJsonCharsForMessageCheck: 0,
            });

            if (detected.isError && detected.code === "FAKE_200_EMPTY_BODY") {
              throw new EmptyResponseError(currentProvider.id, currentProvider.name, "empty_body");
            }

            const isStrongFake200 =
              detected.isError &&
              (detected.code === "FAKE_200_HTML_BODY" ||
                detected.code === "FAKE_200_JSON_ERROR_NON_EMPTY" ||
                detected.code === "FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY");

            if (isStrongFake200) {
              const inferredStatus = inferUpstreamErrorStatusCodeFromText(inspectedText);
              const inferredStatusCode = inferredStatus?.statusCode;

              throw new ProxyError(detected.code, inferredStatusCode ?? 502, {
                body: detected.detail ?? "",
                providerId: currentProvider.id,
                providerName: currentProvider.name,
                // 注意：rawBody 仅用于“本次错误响应”向客户端提供更多排查信息（受系统设置控制），
                // 不参与规则匹配/持久化，避免污染数据库或误触发覆写规则。
                rawBody: inspectedText,
                rawBodyTruncated: inspectedTruncated,
                statusCodeInferred: inferredStatusCode !== undefined,
                statusCodeInferenceMatcherId: inferredStatus?.matcherId,
              });
            }
          }

          // 对于缺失或非法 Content-Length 的情况，需要 clone 并检查响应体
          // 注意：这会增加一定的性能开销，但对于非流式响应是可接受的
          if (!contentLength || !hasValidContentLength) {
            const responseText = inspectedText ?? "";

            if (!responseText || responseText.trim() === "") {
              throw new EmptyResponseError(currentProvider.id, currentProvider.name, "empty_body");
            }

            if (inspectedTruncated) {
              logger.debug(
                "ProxyForwarder: Response body too large for non-stream content check, skipping JSON parse",
                {
                  providerId: currentProvider.id,
                  providerName: currentProvider.name,
                  contentType,
                  maxBytes: NON_STREAM_BODY_INSPECTION_MAX_BYTES,
                }
              );
            } else {
              // 尝试解析 JSON 并检查是否有输出内容
              try {
                const responseJson = JSON.parse(responseText) as Record<string, unknown>;

                // 检测 Claude 格式的空响应
                if (responseJson.type === "message") {
                  const content = responseJson.content as unknown[];
                  if (!content || content.length === 0) {
                    throw new EmptyResponseError(
                      currentProvider.id,
                      currentProvider.name,
                      "missing_content"
                    );
                  }
                }

                // 检测 OpenAI 格式的空响应
                if (responseJson.choices !== undefined) {
                  const choices = responseJson.choices as unknown[];
                  if (!choices || choices.length === 0) {
                    throw new EmptyResponseError(
                      currentProvider.id,
                      currentProvider.name,
                      "missing_content"
                    );
                  }
                }

                // 检测 usage 中的 output_tokens
                const usage = responseJson.usage as Record<string, unknown> | undefined;
                if (usage) {
                  const outputTokens =
                    (usage.output_tokens as number) || (usage.completion_tokens as number) || 0;

                  if (outputTokens === 0) {
                    // 输出 token 为 0，可能是空响应
                    logger.warn("ProxyForwarder: Response has zero output tokens", {
                      providerId: currentProvider.id,
                      providerName: currentProvider.name,
                      usage,
                    });
                    // 注意：不抛出错误，因为某些请求（如 count_tokens）可能合法地返回 0 output tokens
                  }
                }
              } catch (_parseOrContentError) {
                // EmptyResponseError 会触发重试/故障转移，不能在这里被当作 JSON 解析错误吞掉。
                if (isEmptyResponseError(_parseOrContentError)) {
                  throw _parseOrContentError;
                }

                // JSON 解析失败但响应体不为空，不视为空响应错误
                logger.debug("ProxyForwarder: Non-JSON response body, skipping content check", {
                  providerId: currentProvider.id,
                  contentType,
                });
              }
            }
          }

          // ========== 成功分支 ==========
          if (activeEndpoint.endpointId != null) {
            await recordEndpointSuccess(activeEndpoint.endpointId);
          }

          recordSuccess(currentProvider.id);

          // ⭐ 成功后绑定 session 到供应商（智能绑定策略）
          if (session.sessionId) {
            // 使用智能绑定策略（故障转移优先 + 稳定性优化）
            const result = await SessionManager.updateSessionBindingSmart(
              session.sessionId,
              currentProvider.id,
              currentProvider.priority || 0,
              totalProvidersAttempted === 1 && attemptCount === 1, // isFirstAttempt
              totalProvidersAttempted > 1 // isFailoverSuccess: 切换过供应商
            );

            if (result.updated) {
              logger.info("ProxyForwarder: Session binding updated", {
                sessionId: session.sessionId,
                providerId: currentProvider.id,
                providerName: currentProvider.name,
                priority: currentProvider.priority,
                groupTag: currentProvider.groupTag,
                reason: result.reason,
                details: result.details,
                attemptNumber: attemptCount,
                totalProvidersAttempted,
              });
            } else {
              logger.debug("ProxyForwarder: Session binding not updated", {
                sessionId: session.sessionId,
                providerId: currentProvider.id,
                providerName: currentProvider.name,
                priority: currentProvider.priority,
                reason: result.reason,
                details: result.details,
              });
            }

            // ⭐ 统一更新两个数据源（确保监控数据一致）
            // session:provider (真实绑定) 已在 updateSessionBindingSmart 中更新
            // session:info (监控信息) 在此更新
            if (session.shouldTrackSessionObservability()) {
              void SessionManager.updateSessionProvider(session.sessionId, {
                providerId: currentProvider.id,
                providerName: currentProvider.name,
              }).catch((error) => {
                logger.error("ProxyForwarder: Failed to update session provider info", { error });
              });
            }
          }

          // 记录到决策链
          session.addProviderToChain(currentProvider, {
            ...endpointAudit,
            reason:
              totalProvidersAttempted === 1 && attemptCount === 1
                ? "request_success"
                : "retry_success",
            attemptNumber: attemptCount,
            statusCode: response.status,
            circuitState: getCircuitState(currentProvider.id),
          });

          logger.info("ProxyForwarder: Request successful", {
            providerId: currentProvider.id,
            providerName: currentProvider.name,
            attemptNumber: attemptCount,
            totalProvidersAttempted,
            statusCode: response.status,
          });

          return response; // ⭐ 成功：立即返回，结束所有循环
        } catch (error) {
          lastError = error as Error;

          // ⭐ 1. 分类错误（供应商错误 vs 系统错误 vs 客户端中断）
          // 使用异步版本确保错误规则已加载
          let errorCategory = await categorizeErrorAsync(lastError);
          const errorMessage =
            lastError instanceof ProxyError
              ? lastError.getDetailedErrorMessage()
              : lastError.message;

          const isTimeoutError = lastError instanceof ProxyError && lastError.statusCode === 524;

          if (isTimeoutError) {
            timedOutEndpointKeys.add(
              buildEndpointAttemptKey(activeEndpoint.endpointId, activeEndpoint.baseUrl)
            );
          }

          if (activeEndpoint.endpointId != null) {
            if (isTimeoutError || errorCategory === ErrorCategory.SYSTEM_ERROR) {
              await recordEndpointFailure(activeEndpoint.endpointId, lastError);
            }
          }

          // ⭐ 2. 客户端中断处理（不计入熔断器，不重试，立即返回）
          if (errorCategory === ErrorCategory.CLIENT_ABORT) {
            logger.warn("ProxyForwarder: Client aborted, stopping immediately", {
              providerId: currentProvider.id,
              providerName: currentProvider.name,
              attemptNumber: attemptCount,
              totalProvidersAttempted,
            });

            await ProxyForwarder.clearSessionProviderBinding(session);

            // 记录到决策链（标记为客户端中断）
            session.addProviderToChain(currentProvider, {
              ...endpointAudit,
              reason: "client_abort",
              circuitState: getCircuitState(currentProvider.id),
              attemptNumber: attemptCount,
              errorMessage: "Client aborted request",
              errorDetails: {
                system: {
                  errorType: "ClientAbort",
                  errorName: "ClientAbort",
                  errorMessage: "Client aborted request",
                },
                request: buildRequestDetails(session),
              },
            });

            throw lastError;
          }

          // 2.5 Reactive rectifier：命中后对同供应商“整流 + 重试一次”
          const reactiveRectifierResult = await tryApplyReactiveAnthropicRectifier({
            provider: currentProvider,
            requestSession: session,
            persistSession: session,
            errorMessage,
            attemptNumber: attemptCount,
            retryAttemptNumber: attemptCount + 1,
            retryState: reactiveRectifierRetryState,
          });

          if (reactiveRectifierResult.matched) {
            if (!reactiveRectifierResult.applied) {
              if (reactiveRectifierResult.reason === "not_applicable") {
                logger.info(
                  `ProxyForwarder: ${getReactiveRectifierDisplayName(
                    reactiveRectifierResult.rectifierType
                  )} not applicable, skipping retry`,
                  {
                    providerId: currentProvider.id,
                    providerName: currentProvider.name,
                    trigger: reactiveRectifierResult.trigger,
                    attemptNumber: attemptCount,
                  }
                );
              }

              errorCategory = ErrorCategory.NON_RETRYABLE_CLIENT_ERROR;
            } else {
              logger.info(
                `ProxyForwarder: ${getReactiveRectifierDisplayName(
                  reactiveRectifierResult.rectifierType
                )} applied, retrying`,
                {
                  providerId: currentProvider.id,
                  providerName: currentProvider.name,
                  trigger: reactiveRectifierResult.trigger,
                  attemptNumber: attemptCount,
                  willRetryAttemptNumber: attemptCount + 1,
                }
              );

              session.addProviderToChain(
                currentProvider,
                buildRetryFailedChainEntry(
                  currentProvider,
                  endpointAudit,
                  attemptCount,
                  lastError,
                  errorMessage,
                  reactiveRectifierResult.requestDetailsBeforeRectify
                )
              );

              // 确保即使 maxAttemptsPerProvider=1 也能完成一次额外重试
              maxAttemptsPerProvider = Math.max(maxAttemptsPerProvider, attemptCount + 1);
              continue;
            }
          }

          // ⭐ 3. 不可重试的客户端输入错误处理（不计入熔断器，不重试，立即返回）
          if (errorCategory === ErrorCategory.NON_RETRYABLE_CLIENT_ERROR) {
            const detectionResult = await getErrorDetectionResultAsync(lastError);
            const matchedRule = buildMatchedRuleDetails(detectionResult);
            const matchedRuleLogContext = buildMatchedRuleLogContext(matchedRule);
            const clientErrorChainEntry = buildClientErrorChainEntry(
              currentProvider,
              endpointAudit,
              attemptCount,
              lastError,
              errorMessage,
              buildRequestDetails(session),
              matchedRule
            );

            if (lastError instanceof ProxyError) {
              // Original path: full ProxyError fields available
              logger.warn("ProxyForwarder: Non-retryable client error, stopping immediately", {
                providerId: currentProvider.id,
                providerName: currentProvider.name,
                statusCode: lastError.statusCode,
                statusCodeInferred: lastError.upstreamError?.statusCodeInferred ?? false,
                error: errorMessage,
                attemptNumber: attemptCount,
                totalProvidersAttempted,
                reason:
                  "White-listed client error (prompt length, content filter, PDF limit, or thinking format)",
                ...matchedRuleLogContext,
              });
            } else {
              // Plain Error path: omit ProxyError-only fields
              logger.warn(
                "ProxyForwarder: Non-retryable client error (plain error), stopping immediately",
                {
                  providerId: currentProvider.id,
                  providerName: currentProvider.name,
                  error: lastError.message,
                  attemptNumber: attemptCount,
                  totalProvidersAttempted,
                  reason: "White-listed client error matched by error rule",
                  ...matchedRuleLogContext,
                }
              );
            }

            // 记录到决策链（标记为不可重试的客户端错误）
            // 注意：不调用 recordFailure()，因为这不是供应商的问题，是客户端输入问题
            session.addProviderToChain(currentProvider, clientErrorChainEntry);

            // 立即抛出错误，不重试，不切换供应商
            // 白名单错误不计入熔断器，因为是客户端输入问题，不是供应商故障
            throw lastError;
          }

          // ⭐ 4. 系统错误处理（不计入熔断器，先重试1次当前供应商）
          if (errorCategory === ErrorCategory.SYSTEM_ERROR) {
            const err = lastError as Error & {
              code?: string; // Node.js 错误码：如 'ENOTFOUND'、'ECONNREFUSED'、'ETIMEDOUT'、'ECONNRESET'
              errno?: number;
              syscall?: string; // 系统调用：如 'getaddrinfo'、'connect'、'read'、'write'
            };

            logger.warn("ProxyForwarder: System/network error occurred", {
              providerId: currentProvider.id,
              providerName: currentProvider.name,
              error: errorMessage,
              attemptNumber: attemptCount,
              totalProvidersAttempted,
              willRetry: attemptCount < maxAttemptsPerProvider,
            });

            // 记录到决策链（不计入 failedProviderIds）
            session.addProviderToChain(currentProvider, {
              ...endpointAudit,
              reason: "system_error",
              circuitState: getCircuitState(currentProvider.id),
              attemptNumber: attemptCount,
              errorMessage: errorMessage,
              errorDetails: {
                system: {
                  errorType: err.constructor.name,
                  errorName: err.name,
                  errorMessage: err.message || err.name || "Unknown error",
                  errorCode: err.code,
                  errorSyscall: err.syscall,
                  errorStack: err.stack?.split("\n").slice(0, 3).join("\n"),
                },
                request: buildRequestDetails(session),
              },
            });

            // 第1次失败：等待100ms后重试当前供应商
            if (attemptCount < maxAttemptsPerProvider) {
              // Network error: advance to next endpoint for retry
              // This implements "endpoint stickiness" where network errors switch endpoints
              // but non-network errors (PROVIDER_ERROR) keep the same endpoint
              currentEndpointIndex++;
              logger.debug("ProxyForwarder: Advancing endpoint index due to network error", {
                providerId: currentProvider.id,
                previousEndpointIndex: currentEndpointIndex - 1,
                newEndpointIndex: currentEndpointIndex,
                maxEndpointIndex: endpointCandidates.length - 1,
              });

              await new Promise((resolve) => setTimeout(resolve, 100));
              continue; // Continue retry with next endpoint
            }

            // 第2次失败：跳出内层循环，切换供应商
            logger.warn("ProxyForwarder: System error persists, will switch provider", {
              providerId: currentProvider.id,
              providerName: currentProvider.name,
              totalProvidersAttempted,
            });

            // ⭐ 检查是否启用了网络错误计入熔断器
            const env = getEnvConfig();

            // 无论是否计入熔断器，都要加入 failedProviderIds（避免重复选择同一供应商）
            failedProviderIds.push(currentProvider.id);

            if (env.ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS) {
              logger.warn(
                "ProxyForwarder: Network error will be counted towards circuit breaker (enabled by config)",
                {
                  providerId: currentProvider.id,
                  providerName: currentProvider.name,
                  errorType: err.constructor.name,
                  errorCode: err.code,
                }
              );

              // 计入熔断器
              await recordFailure(currentProvider.id, lastError);
            } else {
              logger.debug(
                "ProxyForwarder: Network error not counted towards circuit breaker (disabled by default)",
                {
                  providerId: currentProvider.id,
                  providerName: currentProvider.name,
                }
              );
            }

            break; // ⭐ 跳出内层循环，进入供应商切换逻辑
          }

          // ⭐ 5. 上游 404 错误处理（不计入熔断器，先重试当前供应商，重试耗尽后切换）
          if (errorCategory === ErrorCategory.RESOURCE_NOT_FOUND) {
            const proxyError = lastError as ProxyError;
            const willRetry = attemptCount < maxAttemptsPerProvider;

            logger.warn("ProxyForwarder: Upstream 404 error", {
              providerId: currentProvider.id,
              providerName: currentProvider.name,
              statusCode: 404,
              statusCodeInferred: proxyError.upstreamError?.statusCodeInferred ?? false,
              error: errorMessage,
              attemptNumber: attemptCount,
              totalProvidersAttempted,
              willRetry,
            });

            // 记录到决策链（标记为 resource_not_found，不计入熔断）
            session.addProviderToChain(currentProvider, {
              ...endpointAudit,
              reason: "resource_not_found",
              circuitState: getCircuitState(currentProvider.id),
              attemptNumber: attemptCount,
              errorMessage: errorMessage,
              statusCode: 404,
              statusCodeInferred: proxyError.upstreamError?.statusCodeInferred ?? false,
              errorDetails: {
                provider: {
                  id: currentProvider.id,
                  name: currentProvider.name,
                  statusCode: 404,
                  statusText: proxyError.message,
                  upstreamBody: proxyError.upstreamError?.body,
                  upstreamParsed: proxyError.upstreamError?.parsed,
                },
                request: buildRequestDetails(session),
              },
            });

            // 不调用 recordFailure()，不计入熔断器

            // 未耗尽重试次数：等待 100ms 后继续重试当前供应商
            if (willRetry) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              continue;
            }

            // 重试耗尽：加入失败列表并切换供应商
            failedProviderIds.push(currentProvider.id);
            break; // ⭐ 跳出内层循环，进入供应商切换逻辑
          }

          // ⭐ 6. 供应商错误处理（所有 4xx/5xx HTTP 错误 + 空响应错误，计入熔断器，重试耗尽后切换）
          if (errorCategory === ErrorCategory.PROVIDER_ERROR) {
            // 🆕 空响应错误特殊处理（EmptyResponseError 不是 ProxyError）
            if (isEmptyResponseError(lastError)) {
              const emptyError = lastError as EmptyResponseError;
              const willRetry = attemptCount < maxAttemptsPerProvider;

              logger.warn("ProxyForwarder: Empty response detected", {
                providerId: currentProvider.id,
                providerName: currentProvider.name,
                reason: emptyError.reason,
                error: emptyError.message,
                attemptNumber: attemptCount,
                totalProvidersAttempted,
                willRetry,
              });

              // 获取熔断器健康信息
              const { health, config } = await getProviderHealthInfo(currentProvider.id);

              // 记录到决策链
              session.addProviderToChain(currentProvider, {
                ...endpointAudit,
                reason: "retry_failed",
                circuitState: getCircuitState(currentProvider.id),
                attemptNumber: attemptCount,
                errorMessage: emptyError.message,
                circuitFailureCount: health.failureCount + 1,
                circuitFailureThreshold: config.failureThreshold,
                statusCode: 520, // Web Server Returned an Unknown Error
                errorDetails: {
                  provider: {
                    id: currentProvider.id,
                    name: currentProvider.name,
                    statusCode: 520,
                    statusText: `Empty response: ${emptyError.reason}`,
                  },
                  request: buildRequestDetails(session),
                },
              });

              // 未耗尽重试次数：等待 100ms 后继续重试当前供应商
              if (willRetry) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                continue;
              }

              // 重试耗尽：计入熔断器并切换供应商
              if (!session.isProbeRequest()) {
                await recordFailure(currentProvider.id, lastError);
              }

              failedProviderIds.push(currentProvider.id);
              break; // 跳出内层循环，进入供应商切换逻辑
            }

            // 常规 ProxyError 处理
            const proxyError = lastError as ProxyError;
            const statusCode = proxyError.statusCode;
            const willRetry = attemptCount < maxAttemptsPerProvider;

            if (
              !isMcpRequest &&
              statusCode === 524 &&
              currentProvider.providerVendorId &&
              endpointCandidateKeys.size > 0 &&
              timedOutEndpointKeys.size >= endpointCandidateKeys.size &&
              !willRetry
            ) {
              // Record to decision chain BEFORE triggering vendor-type circuit breaker
              session.addProviderToChain(currentProvider, {
                ...endpointAudit,
                reason: "vendor_type_all_timeout",
                attemptNumber: attemptCount,
                statusCode: 524,
                errorMessage: errorMessage,
                errorDetails: {
                  provider: {
                    id: currentProvider.id,
                    name: currentProvider.name,
                    statusCode: 524,
                    statusText: proxyError.message,
                    upstreamBody: proxyError.upstreamError?.body,
                    upstreamParsed: proxyError.upstreamError?.parsed,
                  },
                  request: buildRequestDetails(session),
                },
              });

              await recordVendorTypeAllEndpointsTimeout(
                currentProvider.providerVendorId,
                currentProvider.providerType
              );
              failedProviderIds.push(currentProvider.id);
              break;
            }

            // Raw passthrough endpoints: no circuit breaker, no provider switch, no retry
            const endpointPolicy = session.getEndpointPolicy();
            if (!endpointPolicy.allowRetry) {
              logger.debug(
                "ProxyForwarder: raw passthrough endpoint error, skipping circuit breaker and provider switch",
                {
                  providerId: currentProvider.id,
                  providerName: currentProvider.name,
                  statusCode,
                  error: proxyError.message,
                  policyKind: endpointPolicy.kind,
                }
              );
              // Throw immediately: no retry, no provider switch
              throw lastError;
            }

            logger.warn("ProxyForwarder: Provider error occurred", {
              providerId: currentProvider.id,
              providerName: currentProvider.name,
              statusCode: statusCode,
              statusCodeInferred: proxyError.upstreamError?.statusCodeInferred ?? false,
              error: errorMessage,
              attemptNumber: attemptCount,
              totalProvidersAttempted,
              willRetry,
            });

            // 获取熔断器健康信息（用于决策链显示）
            const { health, config } = await getProviderHealthInfo(currentProvider.id);

            // 记录到决策链
            session.addProviderToChain(currentProvider, {
              ...endpointAudit,
              reason: "retry_failed",
              circuitState: getCircuitState(currentProvider.id),
              attemptNumber: attemptCount,
              errorMessage: errorMessage,
              circuitFailureCount: health.failureCount + 1, // 包含本次失败
              circuitFailureThreshold: config.failureThreshold,
              statusCode: statusCode,
              statusCodeInferred: proxyError.upstreamError?.statusCodeInferred ?? false,
              errorDetails: {
                provider: {
                  id: currentProvider.id,
                  name: currentProvider.name,
                  statusCode: statusCode,
                  statusText: proxyError.message,
                  upstreamBody: proxyError.upstreamError?.body,
                  upstreamParsed: proxyError.upstreamError?.parsed,
                },
                request: buildRequestDetails(session),
              },
            });

            // 未耗尽重试次数：等待 100ms 后继续重试当前供应商
            if (willRetry) {
              if (statusCode === 524) {
                currentEndpointIndex++;
                logger.debug("ProxyForwarder: Advancing endpoint index due to upstream timeout", {
                  providerId: currentProvider.id,
                  previousEndpointIndex: currentEndpointIndex - 1,
                  newEndpointIndex: currentEndpointIndex,
                  maxEndpointIndex: endpointCandidates.length - 1,
                });
              }

              await new Promise((resolve) => setTimeout(resolve, 100));
              continue;
            }

            // ⭐ 重试耗尽：只有非探测请求才计入熔断器
            if (session.isProbeRequest()) {
              logger.debug("ProxyForwarder: Probe request error, skipping circuit breaker", {
                providerId: currentProvider.id,
                providerName: currentProvider.name,
                messagesCount: session.getMessagesLength(),
              });
            } else {
              await recordFailure(currentProvider.id, lastError);
            }

            // 加入失败列表并切换供应商
            failedProviderIds.push(currentProvider.id);
            break; // 跳出内层循环，进入供应商切换逻辑
          }
        }
      } // ========== 内层循环结束 ==========

      // ========== 供应商切换逻辑 ==========
      const alternativeProvider = await ProxyForwarder.selectAlternative(
        session,
        failedProviderIds
      );

      if (!alternativeProvider) {
        // ⭐ 无可用供应商：所有供应商都失败了
        logger.error("ProxyForwarder: All providers failed", {
          totalProvidersAttempted,
          failedProviderCount: failedProviderIds.length,
          // 不记录详细供应商列表（安全考虑）
        });
        break; // 退出外层循环
      }

      // 切换到新供应商
      currentProvider = alternativeProvider;
      session.setProvider(currentProvider);

      logger.info("ProxyForwarder: Switched to alternative provider", {
        totalProvidersAttempted,
        newProviderId: currentProvider.id,
        newProviderName: currentProvider.name,
      });

      // ⭐ 继续外层循环（尝试新供应商）
    } // ========== 外层循环结束 ==========

    // ========== 所有供应商都失败：抛出简化错误 ==========
    // ⭐ 检查是否达到保险栓上限
    if (totalProvidersAttempted >= MAX_PROVIDER_SWITCHES) {
      logger.error("ProxyForwarder: Exceeded max provider switches (safety limit)", {
        totalProvidersAttempted,
        maxSwitches: MAX_PROVIDER_SWITCHES,
        failedProviderCount: failedProviderIds.length,
      });
    }

    // ⭐ 不暴露供应商详情，仅返回简单错误
    await ProxyForwarder.clearSessionProviderBinding(session);
    throw ProxyForwarder.buildAllProvidersUnavailableError(); // Service Unavailable
  }

  /**
   * 实际转发请求
   */
  private static async doForward(
    session: ProxySession,
    provider: typeof session.provider,
    baseUrl: string,
    endpointAudit?: { endpointId: number | null; endpointUrl: string },
    attemptNumber?: number,
    deferDetailSnapshotPersistence: boolean = false
  ): Promise<Response> {
    if (!provider) {
      throw new Error("Provider is required");
    }

    const resolvedCacheTtl = resolveCacheTtlPreference(
      session.authState?.key?.cacheTtlPreference,
      provider.cacheTtlPreference
    );
    session.setCacheTtlResolved(resolvedCacheTtl);

    // 1M context: GA, no longer needs beta header. Just record if client sent the header.
    const isAnthropicProvider =
      provider.providerType === "claude" || provider.providerType === "claude-auth";
    if (isAnthropicProvider && session.clientRequestsContext1m()) {
      session.setContext1mApplied(true);
    }

    // Apply model redirect (if configured) - skip for raw passthrough endpoints
    if (!session.getEndpointPolicy().bypassForwarderPreprocessing) {
      const wasRedirected = ModelRedirector.apply(session, provider);
      if (wasRedirected) {
        logger.debug("ProxyForwarder: Model redirected", {
          providerId: provider.id,
        });
      }
    }

    let processedHeaders: Headers;
    let requestBody: BodyInit | undefined;
    let isStreaming = false;
    let proxyUrl: string;
    let isApiKey = false;

    // --- GEMINI HANDLING ---
    if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
      // 1. 直接透传请求体（不转换）- 仅对有 body 的请求
      const hasBody = session.method !== "GET" && session.method !== "HEAD";
      if (hasBody) {
        let bodyToSerialize = session.request.message as Record<string, unknown>;

        // Apply Gemini Google Search override if configured
        const { request: overriddenBody, audit: googleSearchAudit } =
          applyGeminiGoogleSearchOverrideWithAudit(
            provider,
            bodyToSerialize,
            session.requestUrl.pathname
          );
        if (googleSearchAudit) {
          session.addSpecialSetting(googleSearchAudit);
          bodyToSerialize = overriddenBody;
          session.request.message = overriddenBody;

          // Persist special settings immediately (same pattern as Anthropic overrides)
          const specialSettings = session.getSpecialSettings();
          if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
            await SessionManager.storeSessionSpecialSettings(
              session.sessionId,
              specialSettings,
              session.requestSequence
            ).catch((err) => {
              logger.error("[ProxyForwarder] Failed to store Gemini special settings", {
                error: err,
                sessionId: session.sessionId,
              });
            });
          }
          if (session.messageContext?.id) {
            await updateMessageRequestDetails(session.messageContext.id, {
              specialSettings,
            }).catch((err) => {
              logger.error("[ProxyForwarder] Failed to persist Gemini special settings", {
                error: err,
                messageRequestId: session.messageContext?.id,
              });
            });
          }
        }

        // 检测流式请求：Gemini 支持两种方式
        // 1. URL 路径检测（官方 Gemini API）: /v1beta/models/xxx:streamGenerateContent?alt=sse
        // 2. 请求体 stream 字段（某些兼容 API）: { stream: true }
        const geminiPathname = session.requestUrl.pathname || "";
        const geminiSearchParams = session.requestUrl.searchParams;
        const originalBody = session.request.message as Record<string, unknown>;
        isStreaming =
          geminiPathname.includes("streamGenerateContent") ||
          geminiSearchParams.get("alt") === "sse" ||
          originalBody?.stream === true;

        // 2. 准备认证和 Headers
        const accessToken = await GeminiAuth.getAccessToken(provider.key);
        isApiKey = GeminiAuth.isApiKey(provider.key);

        // 3. 直接透传：使用 buildProxyUrl() 拼接原始路径和查询参数
        const effectiveBaseUrl =
          baseUrl ||
          provider.url ||
          (provider.providerType === "gemini"
            ? GEMINI_PROTOCOL.OFFICIAL_ENDPOINT
            : GEMINI_PROTOCOL.CLI_ENDPOINT);

        proxyUrl = buildProxyUrl(effectiveBaseUrl, session.requestUrl);

        // 4. Headers 处理：默认透传 session.headers（含请求过滤器修改），但移除代理认证头并覆盖上游鉴权
        // 说明：之前 Gemini 分支使用 new Headers() 重建 headers，会导致 user-agent 丢失且过滤器不生效
        processedHeaders = ProxyForwarder.buildGeminiHeaders(
          session,
          provider,
          effectiveBaseUrl,
          accessToken,
          isApiKey
        );

        // Final-phase request filter for Gemini: after headers built, before body serialization
        // Clone body to prevent in-place mutation of session.request.message on retries
        if (!session.getEndpointPolicy().bypassRequestFilters) {
          const { requestFilterEngine } = await import("@/lib/request-filter-engine");
          const bodyForFinal = structuredClone(bodyToSerialize);
          await requestFilterEngine.applyFinal(session, bodyForFinal, processedHeaders);
          bodyToSerialize = bodyForFinal;
        }

        const bodyString = JSON.stringify(bodyToSerialize);
        requestBody = bodyString;
        session.forwardedRequestBody = bodyString;
      } else {
        // No body: still need streaming detection, auth, URL, headers
        const geminiPathname = session.requestUrl.pathname || "";
        const geminiSearchParams = session.requestUrl.searchParams;
        isStreaming =
          geminiPathname.includes("streamGenerateContent") ||
          geminiSearchParams.get("alt") === "sse";

        const accessToken = await GeminiAuth.getAccessToken(provider.key);
        isApiKey = GeminiAuth.isApiKey(provider.key);

        const effectiveBaseUrl =
          baseUrl ||
          provider.url ||
          (provider.providerType === "gemini"
            ? GEMINI_PROTOCOL.OFFICIAL_ENDPOINT
            : GEMINI_PROTOCOL.CLI_ENDPOINT);

        proxyUrl = buildProxyUrl(effectiveBaseUrl, session.requestUrl);

        processedHeaders = ProxyForwarder.buildGeminiHeaders(
          session,
          provider,
          effectiveBaseUrl,
          accessToken,
          isApiKey
        );

        // Final-phase request filter for no-body requests (header-only operations)
        if (!session.getEndpointPolicy().bypassRequestFilters) {
          const { requestFilterEngine } = await import("@/lib/request-filter-engine");
          await requestFilterEngine.applyFinal(
            session,
            {} as Record<string, unknown>,
            processedHeaders
          );
        }
      }

      if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
        void SessionManager.storeSessionUpstreamRequestMeta(
          session.sessionId,
          { url: proxyUrl, method: session.method },
          session.requestSequence
        ).catch((err) => logger.error("Failed to store upstream request meta:", err));

        void SessionManager.storeSessionRequestHeaders(
          session.sessionId,
          processedHeaders,
          session.requestSequence
        ).catch((err) => logger.error("Failed to store request headers:", err));
      }

      logger.debug("ProxyForwarder: Gemini request passthrough", {
        providerId: provider.id,
        type: provider.providerType,
        url: proxyUrl,
        originalPath: session.requestUrl.pathname,
        isStreaming,
        isApiKey,
      });
    } else {
      // --- STANDARD HANDLING ---
      if (!session.getEndpointPolicy().bypassForwarderPreprocessing) {
        // Codex 供应商级参数覆写（默认 inherit=遵循客户端）
        if (provider.providerType === "codex") {
          const { request: overridden, audit } = applyCodexProviderOverridesWithAudit(
            provider,
            session.request.message as Record<string, unknown>
          );
          session.request.message = overridden;

          if (audit) {
            session.addSpecialSetting(audit);
            const specialSettings = session.getSpecialSettings();

            if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
              // 这里用 await：避免后续响应侧写入（ResponseFixer 等）先完成后，被本次旧快照覆写
              await SessionManager.storeSessionSpecialSettings(
                session.sessionId,
                specialSettings,
                session.requestSequence
              ).catch((err) => {
                logger.error("[ProxyForwarder] Failed to store special settings", {
                  error: err,
                  sessionId: session.sessionId,
                });
              });
            }

            if (session.messageContext?.id) {
              // 同上：确保 special_settings 的"旧值"不会在并发下覆盖"新值"
              await updateMessageRequestDetails(session.messageContext.id, {
                specialSettings,
              }).catch((err) => {
                logger.error("[ProxyForwarder] Failed to persist special settings", {
                  error: err,
                  messageRequestId: session.messageContext?.id,
                });
              });
            }
          }
        }

        // Anthropic 供应商级参数覆写（默认 inherit=遵循客户端）
        // 说明：允许管理员在供应商层面强制覆写 max_tokens 和 thinking.budget_tokens
        if (provider.providerType === "claude" || provider.providerType === "claude-auth") {
          // Billing header rectifier: proactively strip x-anthropic-billing-header from system prompt
          {
            const settings = await getCachedSystemSettings();
            const billingRectifierEnabled = settings.enableBillingHeaderRectifier ?? true;
            if (billingRectifierEnabled) {
              const billingResult = rectifyBillingHeader(
                session.request.message as Record<string, unknown>
              );
              if (billingResult.applied) {
                session.addSpecialSetting({
                  type: "billing_header_rectifier",
                  scope: "request",
                  hit: true,
                  removedCount: billingResult.removedCount,
                  extractedValues: billingResult.extractedValues,
                });
                logger.info("ProxyForwarder: Billing header rectifier applied", {
                  providerId: provider.id,
                  providerName: provider.name,
                  removedCount: billingResult.removedCount,
                });
                await persistSpecialSettings(session);
              }
            }
          }

          const { request: anthropicOverridden, audit: anthropicAudit } =
            applyAnthropicProviderOverridesWithAudit(
              provider,
              session.request.message as Record<string, unknown>
            );
          session.request.message = anthropicOverridden;

          if (anthropicAudit) {
            session.addSpecialSetting(anthropicAudit);
            const specialSettings = session.getSpecialSettings();

            if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
              await SessionManager.storeSessionSpecialSettings(
                session.sessionId,
                specialSettings,
                session.requestSequence
              ).catch((err) => {
                logger.error("[ProxyForwarder] Failed to store Anthropic special settings", {
                  error: err,
                  sessionId: session.sessionId,
                });
              });
            }

            if (session.messageContext?.id) {
              await updateMessageRequestDetails(session.messageContext.id, {
                specialSettings,
              }).catch((err) => {
                logger.error("[ProxyForwarder] Failed to persist Anthropic special settings", {
                  error: err,
                  messageRequestId: session.messageContext?.id,
                });
              });
            }
          }
        }

        if (
          resolvedCacheTtl &&
          (provider.providerType === "claude" || provider.providerType === "claude-auth")
        ) {
          const applied = applyCacheTtlOverrideToMessage(session.request.message, resolvedCacheTtl);
          if (applied) {
            logger.debug("ProxyForwarder: Applied cache TTL override to request", {
              providerId: provider.id,
              ttl: resolvedCacheTtl,
            });
          }
        }
      } // end bypassForwarderPreprocessing gate

      processedHeaders = ProxyForwarder.buildHeaders(session, provider);

      if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
        void SessionManager.storeSessionRequestHeaders(
          session.sessionId,
          processedHeaders,
          session.requestSequence
        ).catch((err) => logger.error("Failed to store request headers:", err));
      }

      if (process.env.NODE_ENV === "development") {
        logger.trace("ProxyForwarder: Final request headers", {
          provider: provider.name,
          providerType: provider.providerType,
          headers: Object.fromEntries(processedHeaders.entries()),
        });
      }

      // ⭐ MCP 透传处理：检测是否为 MCP 请求，并使用相应的 URL
      let effectiveBaseUrl = baseUrl || provider.url;

      // 检测是否为 MCP 请求（非标准 Claude/Codex/OpenAI 端点）
      const requestPath = session.requestUrl.pathname;
      const isStandardRequest = isStandardProxyEndpointPath(requestPath);
      const isMcpRequest = !isStandardRequest;

      if (isMcpRequest && provider.mcpPassthroughType && provider.mcpPassthroughType !== "none") {
        // MCP 透传已启用，且当前是 MCP 请求
        if (provider.mcpPassthroughUrl) {
          // 使用配置的 MCP URL
          effectiveBaseUrl = provider.mcpPassthroughUrl;
          logger.debug("ProxyForwarder: Using configured MCP passthrough URL", {
            providerId: provider.id,
            providerName: provider.name,
            mcpType: provider.mcpPassthroughType,
            configuredUrl: provider.mcpPassthroughUrl,
            requestPath,
          });
        } else {
          // 自动从 baseUrl 提取基础域名（去掉路径部分）
          // 例如：https://api.minimaxi.com/anthropic -> https://api.minimaxi.com
          try {
            const originalBaseUrl = effectiveBaseUrl;
            const baseUrlObj = new URL(originalBaseUrl);
            effectiveBaseUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}`;
            logger.debug("ProxyForwarder: Extracted base domain for MCP passthrough", {
              providerId: provider.id,
              providerName: provider.name,
              mcpType: provider.mcpPassthroughType,
              originalUrl: originalBaseUrl,
              extractedBaseDomain: effectiveBaseUrl,
              requestPath,
            });
          } catch (error) {
            logger.error("ProxyForwarder: Invalid provider URL for MCP passthrough", {
              providerId: provider.id,
              providerUrl: provider.url,
              error,
            });
            throw new ProxyError("Internal configuration error", 500);
          }
        }
      } else if (
        isMcpRequest &&
        (!provider.mcpPassthroughType || provider.mcpPassthroughType === "none")
      ) {
        // MCP 请求但未启用 MCP 透传
        logger.debug(
          "ProxyForwarder: MCP request but passthrough not enabled, using provider URL",
          {
            providerId: provider.id,
            providerName: provider.name,
            requestPath,
          }
        );
      }

      // ⭐ 直接使用原始请求路径，让 buildProxyUrl() 智能处理路径拼接
      // 移除了强制 /v1/responses 路径重写，解决 Issue #139
      // buildProxyUrl() 会检测 base_url 是否已包含完整路径，避免重复拼接
      proxyUrl = buildProxyUrl(effectiveBaseUrl, session.requestUrl);

      // Host header must match actual request target for undici TLS cert validation
      // When provider has multiple endpoints, provider.url and proxyUrl hosts may differ
      const actualHost = HeaderProcessor.extractHost(proxyUrl);
      processedHeaders.set("host", actualHost);

      logger.debug("ProxyForwarder: Final proxy URL", {
        url: proxyUrl,
        originalPath: session.requestUrl.pathname,
        providerType: provider.providerType,
        mcpPassthroughType: provider.mcpPassthroughType,
        usedBaseUrl: effectiveBaseUrl,
      });

      if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
        void SessionManager.storeSessionUpstreamRequestMeta(
          session.sessionId,
          { url: proxyUrl, method: session.method },
          session.requestSequence
        ).catch((err) => logger.error("Failed to store upstream request meta:", err));
      }

      const hasBody = session.method !== "GET" && session.method !== "HEAD";

      if (hasBody) {
        if (session.getEndpointPolicy().bypassForwarderPreprocessing && session.request.buffer) {
          // Raw passthrough: preserve original request body bytes as-is
          requestBody = session.request.buffer;
          session.forwardedRequestBody = session.request.log;

          try {
            isStreaming = (session.request.message as Record<string, unknown>).stream === true;
          } catch {
            isStreaming = false;
          }
        } else if (session.isOpenAIImageMultipartRequest()) {
          const imageRequestMetadata = session.getOpenAIImageRequestMetadata();
          if (!imageRequestMetadata) {
            throw new ProxyError("Invalid request: image multipart metadata is missing.", 400);
          }

          const logicalBody = filterPrivateParameters(
            structuredClone(session.request.message)
          ) as Record<string, unknown>;

          if (!session.getEndpointPolicy().bypassRequestFilters) {
            const { requestFilterEngine } = await import("@/lib/request-filter-engine");
            await requestFilterEngine.applyFinal(session, logicalBody, processedHeaders);
          }

          syncOpenAIImageMultipartFromLogicalBody(imageRequestMetadata, logicalBody);

          const validation = await validateOpenAIImageRequest({
            pathname: requestPath,
            body: logicalBody,
            imageRequestMetadata,
          });
          if (!validation.ok) {
            throw new ProxyError(validation.message ?? "Invalid request.", 400);
          }

          const serializedMultipart =
            await serializeOpenAIImageMultipartRequest(imageRequestMetadata);
          requestBody = serializedMultipart.body;
          session.forwardedRequestBody = serializedMultipart.summary;
          isStreaming = serializedMultipart.isStreaming;

          if (serializedMultipart.contentType) {
            processedHeaders.set("content-type", serializedMultipart.contentType);
          } else {
            processedHeaders.delete("content-type");
          }

          if (process.env.NODE_ENV === "development") {
            logger.trace("ProxyForwarder: Forwarding multipart image request", {
              provider: provider.name,
              providerId: provider.id,
              proxyUrl: proxyUrl,
              format: session.originalFormat,
              method: session.method,
              bodyLength: serializedMultipart.body.byteLength,
              isStreaming,
            });
          }
        } else {
          const filteredMessage = filterPrivateParameters(session.request.message) as Record<
            string,
            unknown
          >;

          // 将 metadata.user_id 注入放在私有参数过滤之后，避免受过滤逻辑影响。
          let messageToSend: Record<string, unknown> = filteredMessage;
          if (provider.providerType === "claude" || provider.providerType === "claude-auth") {
            const settings = await getCachedSystemSettings();
            const enabled = settings.enableClaudeMetadataUserIdInjection ?? true;
            const injection = applyClaudeMetadataUserIdInjectionWithAudit(
              filteredMessage,
              session,
              enabled
            );

            if (injection) {
              messageToSend = injection.message;
              session.addSpecialSetting(injection.audit);
              await persistSpecialSettings(session);
            }
          }

          // Final-phase request filter: after all provider overrides, before serialization
          if (!session.getEndpointPolicy().bypassRequestFilters) {
            const { requestFilterEngine } = await import("@/lib/request-filter-engine");
            await requestFilterEngine.applyFinal(session, messageToSend, processedHeaders);
          }

          if (requestPath === "/v1/images/generations") {
            sanitizeGenerationsRequestForProvider(messageToSend, provider);
          }

          const validation = await validateOpenAIImageRequest({
            pathname: requestPath,
            body: messageToSend,
            imageRequestMetadata: session.getOpenAIImageRequestMetadata(),
          });
          if (!validation.ok) {
            throw new ProxyError(validation.message ?? "Invalid request.", 400);
          }

          const bodyString = JSON.stringify(messageToSend);
          requestBody = bodyString;
          session.forwardedRequestBody = bodyString;

          try {
            const parsed = JSON.parse(bodyString);
            isStreaming = parsed.stream === true;
          } catch {
            isStreaming = false;
          }

          if (process.env.NODE_ENV === "development") {
            logger.trace("ProxyForwarder: Forwarding request", {
              provider: provider.name,
              providerId: provider.id,
              proxyUrl: proxyUrl,
              format: session.originalFormat,
              method: session.method,
              bodyLength: bodyString.length,
              bodyPreview: bodyString.slice(0, 1000),
              isStreaming,
            });
          }
        }
      } else {
        // No body (GET/HEAD): still run final-phase for header-only filter operations
        if (!session.getEndpointPolicy().bypassRequestFilters) {
          const { requestFilterEngine } = await import("@/lib/request-filter-engine");
          await requestFilterEngine.applyFinal(
            session,
            {} as Record<string, unknown>,
            processedHeaders
          );
        }
      }
    }

    if (session.shouldPersistSessionDebugArtifacts()) {
      const detailSnapshotSession = session as ProxySessionWithDetailSnapshotRuntime;
      detailSnapshotSession.detailSnapshotRequestAfter = {
        body: session.forwardedRequestBody ?? null,
        headers: new Headers(processedHeaders),
        meta: {
          clientUrl: null,
          upstreamUrl: proxyUrl,
          method: session.method,
        },
      };
      // 这里是 request.after 唯一稳定时机：最终 headers、proxyUrl、body 都已确定，但尚未真正发往上游。
      if (!deferDetailSnapshotPersistence) {
        void persistRequestAfterSnapshot(session, detailSnapshotSession.detailSnapshotRequestAfter);
      }
    }

    // ⭐ 扩展 RequestInit 类型以支持 undici dispatcher
    interface UndiciFetchOptions extends RequestInit {
      dispatcher?: Dispatcher;
    }

    // ⭐ 双路超时控制（first-byte / total）
    // 注意：由于 undici fetch API 的限制，无法精确分离 DNS/TCP/TLS 连接阶段和响应头接收阶段
    // 参考：https://github.com/nodejs/undici/discussions/1313
    // 1. 首包/总响应超时：根据请求类型选择
    const responseController = new AbortController();
    let responseTimeoutMs: number;
    let responseTimeoutType: string;

    if (isStreaming) {
      // 流式请求：使用首字节超时（快速失败）
      responseTimeoutMs =
        provider.firstByteTimeoutStreamingMs > 0 ? provider.firstByteTimeoutStreamingMs : 0;
      responseTimeoutType = "streaming_first_byte";
    } else {
      // 非流式请求：使用总超时（防止无限挂起）
      responseTimeoutMs =
        provider.requestTimeoutNonStreamingMs > 0 ? provider.requestTimeoutNonStreamingMs : 0;
      responseTimeoutType = "non_streaming_total";
    }

    let responseTimeoutId: NodeJS.Timeout | null = null;
    if (responseTimeoutMs > 0) {
      responseTimeoutId = setTimeout(() => {
        responseController.abort();
        logger.warn("ProxyForwarder: Response timeout", {
          providerId: provider.id,
          providerName: provider.name,
          responseTimeoutMs,
          responseTimeoutType,
          isStreaming,
        });
      }, responseTimeoutMs);
    } else {
      logger.debug("ProxyForwarder: Response timeout disabled", {
        providerId: provider.id,
        providerName: provider.name,
        responseTimeoutType,
      });
    }

    // 2. 组合双路信号：response + client
    let combinedSignal: AbortSignal | undefined;
    const signals = [responseController.signal];
    if (session.clientAbortSignal) {
      signals.push(session.clientAbortSignal);
    }

    // ⭐ AbortSignal.any 实现（兼容所有环境）
    // 原因：Next.js standalone 可能覆盖全局 AbortSignal，导致原生 any 方法不可用
    if ("any" in AbortSignal && typeof AbortSignal.any === "function") {
      // 优先使用原生实现（Node.js 20.3+）
      combinedSignal = AbortSignal.any(signals);
      logger.debug("ProxyForwarder: Using native AbortSignal.any", {
        signalCount: signals.length,
      });
    } else {
      // Polyfill: 手动实现多信号组合逻辑
      logger.debug("ProxyForwarder: Using AbortSignal.any polyfill", {
        signalCount: signals.length,
        reason: "Native AbortSignal.any not available",
      });

      const combinedController = new AbortController();
      const cleanupHandlers: Array<() => void> = [];

      // 为每个信号添加监听器
      for (const signal of signals) {
        // 如果已经有信号中断，立即中断组合信号
        if (signal.aborted) {
          combinedController.abort();
          break;
        }

        // 监听信号中断事件
        const abortHandler = () => {
          // 中断组合信号
          combinedController.abort();
          // 清理所有监听器（避免内存泄漏）
          cleanupHandlers.forEach((cleanup) => cleanup());
        };

        signal.addEventListener("abort", abortHandler, { once: true });

        // 记录清理函数
        cleanupHandlers.push(() => {
          signal.removeEventListener("abort", abortHandler);
        });
      }

      combinedSignal = combinedController.signal;
    }

    const init: UndiciFetchOptions = {
      method: session.method,
      headers: processedHeaders,
      signal: combinedSignal, // 使用组合信号
      ...(requestBody ? { body: requestBody } : {}),
    };

    // ⭐ 获取 HTTP/2 全局开关设置
    const enableHttp2 = await isHttp2Enabled();

    // ⭐ 应用代理配置（如果配置了）- 使用 Agent Pool 缓存连接
    // 注意：proxyConfig 与 directConnectionCacheKey 的声明保持在 try 外部，
    // 以便 catch 块可以根据它们做 fallback / SSL 不健康标记 / ref 释放。
    let proxyConfig: Awaited<ReturnType<typeof getProxyAgentForProvider>> = null;
    // 用于直连场景的 cacheKey + dispatcher id（SSL 错误时标记不健康 / release 校验）
    let directConnectionCacheKey: string | null = null;
    let directConnectionDispatcherId: string | null = null;

    // ⭐ 始终使用容错流处理以减少 "TypeError: terminated" 错误
    // 背景：undici fetch 的自动解压在流被提前终止时会抛出 "TypeError: terminated"
    // 这个问题不仅影响 Gemini，也影响 Codex 和其他所有供应商
    // 使用 fetchWithoutAutoDecode 绕过 undici 的自动解压，手动处理 gzip
    // 并通过 nodeStreamToWebStreamSafe 实现容错流转换（捕获错误并优雅关闭）
    const useErrorTolerantFetch = true;

    let response: Response;
    const fetchStartTime = Date.now();
    try {
      // ⭐ 把 agent 获取 & 配置日志放进 try 块，确保获取后到 fetch 之前任何异常
      // （例如 URL 解析失败）都会走 catch 的统一释放逻辑，避免泄漏 activeRequests。
      proxyConfig = await getProxyAgentForProvider(provider, proxyUrl, enableHttp2);

      if (proxyConfig) {
        init.dispatcher = proxyConfig.agent;
        logger.info("ProxyForwarder: Using proxy", {
          providerId: provider.id,
          providerName: provider.name,
          proxyUrl: proxyConfig.proxyUrl,
          fallbackToDirect: proxyConfig.fallbackToDirect,
          targetUrl: new URL(proxyUrl).origin,
          http2Enabled: proxyConfig.http2Enabled,
        });
      } else if (enableHttp2) {
        // 直连场景：使用 Agent Pool 获取缓存的 HTTP/2 Agent（避免内存泄漏）
        const pool = getGlobalAgentPool();
        const { agent, cacheKey, dispatcherId } = await pool.getAgent({
          endpointUrl: proxyUrl,
          proxyUrl: null,
          enableHttp2: true,
        });
        init.dispatcher = agent;
        directConnectionCacheKey = cacheKey;
        directConnectionDispatcherId = dispatcherId;
        logger.debug("ProxyForwarder: Using cached HTTP/2 Agent for direct connection", {
          providerId: provider.id,
          providerName: provider.name,
          cacheKey,
        });
      }

      (init as Record<string, unknown>).verbose = true;

      // ⭐ 所有供应商使用 undici.request 绕过 fetch 的自动解压
      // 原因：undici fetch 无法关闭自动解压，上游可能无视 accept-encoding: identity 返回 gzip
      // 当 gzip 流被提前终止时（如连接关闭），undici Gunzip 会抛出 "TypeError: terminated"
      response = useErrorTolerantFetch
        ? await ProxyForwarder.fetchWithoutAutoDecode(
            proxyUrl,
            init,
            provider.id,
            provider.name,
            session,
            deferDetailSnapshotPersistence
          )
        : await fetch(proxyUrl, init);
      // ⭐ fetch 成功：收到 HTTP 响应头，保留响应超时继续监控
      // 注意：undici 的 fetch 在收到 HTTP 响应头后就 resolve，但实际数据（SSE 首字节 / 完整 JSON）
      // 还没到达。responseTimeoutId 需要延续到 response-handler 中才能真正控制"首字节"或"总耗时"
      const headersDuration = Date.now() - fetchStartTime;
      logger.debug("ProxyForwarder: HTTP headers received", {
        providerId: provider.id,
        providerName: provider.name,
        headersReceivedMs: headersDuration,
        note: "Response timeout continues to monitor body reading",
      });
      // ⚠️ 不要清除 responseTimeoutId！让它继续监控响应体读取
    } catch (fetchError) {
      // ⭐ fetch 失败：清除所有超时定时器
      if (responseTimeoutId) {
        clearTimeout(responseTimeoutId);
      }

      // Release agent ref count on fetch failure (request never started streaming)
      const releaseKey = proxyConfig?.cacheKey ?? directConnectionCacheKey;
      const releaseDispatcherId = proxyConfig?.dispatcherId ?? directConnectionDispatcherId;
      if (releaseKey && releaseDispatcherId) {
        getGlobalAgentPool().releaseAgent(releaseKey, releaseDispatcherId);
      }

      // 捕获 fetch 原始错误（网络错误、DNS 解析失败、连接失败等）
      const err = fetchError as Error & {
        cause?: unknown;
        code?: string; // Node.js 错误码：如 'ENOTFOUND'、'ECONNREFUSED'、'ETIMEDOUT'、'ECONNRESET'
        errno?: number;
        syscall?: string; // 系统调用：如 'getaddrinfo'、'connect'、'read'、'write'
      };

      // ⭐ SSL 证书错误检测：标记 Agent 为不健康，下次请求将创建新 Agent
      const sslErrorCacheKey = proxyConfig?.cacheKey ?? directConnectionCacheKey;
      if (isSSLCertificateError(err) && sslErrorCacheKey) {
        const pool = getGlobalAgentPool();
        pool.markUnhealthy(sslErrorCacheKey, err.message);
        logger.warn("ProxyForwarder: SSL certificate error detected, marked agent as unhealthy", {
          providerId: provider.id,
          providerName: provider.name,
          cacheKey: sslErrorCacheKey,
          connectionType: proxyConfig ? "proxy" : "direct",
          errorMessage: err.message,
          errorCode: err.code,
        });
      }

      // ⭐ 超时错误检测（优先级：response > client）

      if (responseController.signal.aborted && !session.clientAbortSignal?.aborted) {
        // 响应超时：HTTP 首包未在规定时间内到达
        // 修复：首字节超时应归类为供应商问题，计入熔断器并直接切换
        logger.error("ProxyForwarder: Response timeout (provider quality issue, will switch)", {
          providerId: provider.id,
          providerName: provider.name,
          responseTimeoutMs,
          responseTimeoutType,
          isStreaming,
          errorName: err.name,
          errorMessage: err.message || "(empty message)",
          reason:
            "First-byte timeout indicates slow provider response, should count towards circuit breaker",
        });

        // 抛出 ProxyError 并设置特殊状态码 524（Cloudflare: A Timeout Occurred）
        // 这样会被归类为 PROVIDER_ERROR，计入熔断器并直接切换供应商
        throw new ProxyError(
          `${responseTimeoutType === "streaming_first_byte" ? "供应商首字节响应超时" : "供应商响应超时"}: ${responseTimeoutMs}ms 内未收到数据`,
          524, // 524 = A Timeout Occurred (Cloudflare standard)
          {
            body: JSON.stringify({
              error: {
                type: "timeout_error",
                message: `Provider failed to respond within ${responseTimeoutMs}ms`,
                timeout_type: responseTimeoutType,
                timeout_ms: responseTimeoutMs,
              },
            }),
            parsed: {
              error: {
                type: "timeout_error",
                message: `Provider failed to respond within ${responseTimeoutMs}ms`,
                timeout_type: responseTimeoutType,
                timeout_ms: responseTimeoutMs,
              },
            },
            providerId: provider.id,
            providerName: provider.name,
          }
        );
      }

      // ⭐ 检测流式静默期超时（streaming_idle）
      if (err.message?.includes("streaming_idle") && !session.clientAbortSignal?.aborted) {
        // 流式静默期超时：首字节之后的连续静默窗口超时
        // 修复：静默期超时也是供应商问题，应计入熔断器
        logger.error(
          "ProxyForwarder: Streaming idle timeout (provider quality issue, will switch)",
          {
            providerId: provider.id,
            providerName: provider.name,
            idleTimeoutMs: provider.streamingIdleTimeoutMs,
            errorName: err.name,
            errorMessage: err.message || "(empty message)",
            errorCode: err.code || "N/A",
            reason:
              "Idle timeout indicates provider stopped sending data, should count towards circuit breaker",
          }
        );

        // 抛出 ProxyError（归类为 PROVIDER_ERROR）
        throw new ProxyError(
          `供应商流式响应静默超时: ${provider.streamingIdleTimeoutMs}ms 内未收到新数据`,
          524, // 524 = A Timeout Occurred
          {
            body: JSON.stringify({
              error: {
                type: "streaming_idle_timeout",
                message: `Provider stopped sending data for ${provider.streamingIdleTimeoutMs}ms`,
                timeout_ms: provider.streamingIdleTimeoutMs,
              },
            }),
            parsed: {
              error: {
                type: "streaming_idle_timeout",
                message: `Provider stopped sending data for ${provider.streamingIdleTimeoutMs}ms`,
                timeout_ms: provider.streamingIdleTimeoutMs,
              },
            },
            providerId: provider.id,
            providerName: provider.name,
          }
        );
      }

      // ⭐ 检测客户端主动中断（使用统一的精确检测函数）
      if (isClientAbortError(err)) {
        logger.warn("ProxyForwarder: Request/response aborted", {
          providerId: provider.id,
          providerName: provider.name,
          proxyUrl: new URL(proxyUrl).origin,
          errorName: err.name,
          errorMessage: err.message || "(empty message)",
          errorCode: err.code || "N/A",
        });

        // 客户端中断不应计入熔断器，也不重试，直接抛出错误
        throw new ProxyError(
          err.name === "ResponseAborted"
            ? "Response transmission aborted"
            : "Request aborted by client",
          499, // Nginx 使用的 "Client Closed Request" 状态码
          undefined,
          true
        );
      }

      // ⭐ HTTP/2 协议错误检测与透明回退
      // 场景：HTTP/2 连接失败（GOAWAY、RST_STREAM、PROTOCOL_ERROR 等）
      // 策略：透明回退到 HTTP/1.1，不触发供应商切换或熔断器
      if (enableHttp2 && isHttp2Error(err)) {
        logger.warn("ProxyForwarder: HTTP/2 protocol error detected, falling back to HTTP/1.1", {
          providerId: provider.id,
          providerName: provider.name,
          errorName: err.name,
          errorMessage: err.message || "(empty message)",
          errorCode: err.code || "N/A",
        });

        // 记录到决策链（标记为 HTTP/2 回退）
        session.addProviderToChain(provider, {
          ...(endpointAudit ?? { endpointId: null, endpointUrl: sanitizeUrl(baseUrl) }),
          reason: "http2_fallback",
          circuitState: getCircuitState(provider.id),
          attemptNumber: attemptNumber ?? 1,
          errorMessage: `HTTP/2 error: ${err.message}`,
          errorDetails: {
            system: {
              errorType: "Http2Error",
              errorName: err.name,
              errorMessage: err.message || err.name || "HTTP/2 protocol error",
              errorCode: err.code,
              errorStack: err.stack?.split("\n").slice(0, 3).join("\n"),
            },
            // W-011: 添加 request 字段以保持与其他错误处理一致
            request: buildRequestDetails(session),
          },
        });

        // 创建 HTTP/1.1 回退配置（移除 HTTP/2 Agent）
        const http1FallbackInit = { ...init };
        delete http1FallbackInit.dispatcher;

        // ⭐ 标记 HTTP/2 Agent 为不健康，避免后续请求重复失败
        const http2CacheKey = proxyConfig?.cacheKey ?? directConnectionCacheKey;
        if (http2CacheKey) {
          const pool = getGlobalAgentPool();
          pool.markUnhealthy(http2CacheKey, `HTTP/2 protocol error: ${err.message}`);
          logger.debug("ProxyForwarder: Marked HTTP/2 agent as unhealthy due to protocol error", {
            providerId: provider.id,
            providerName: provider.name,
            cacheKey: http2CacheKey,
          });
        }

        // 如果使用了代理，创建不支持 HTTP/2 的代理 Agent
        let http1ProxyConfig: typeof proxyConfig = null;
        if (proxyConfig) {
          http1ProxyConfig = await getProxyAgentForProvider(provider, proxyUrl, false);
          if (http1ProxyConfig) {
            http1FallbackInit.dispatcher = http1ProxyConfig.agent;
          }
        }

        try {
          // 使用 HTTP/1.1 重试
          response = useErrorTolerantFetch
            ? await ProxyForwarder.fetchWithoutAutoDecode(
                proxyUrl,
                http1FallbackInit,
                provider.id,
                provider.name,
                session,
                deferDetailSnapshotPersistence
              )
            : await fetch(proxyUrl, http1FallbackInit);

          logger.info("ProxyForwarder: HTTP/1.1 fallback succeeded", {
            providerId: provider.id,
            providerName: provider.name,
          });

          // Update tracking to the H1 fallback agent (H2 agent was already released at catch-block top)
          proxyConfig = http1ProxyConfig;
          directConnectionCacheKey = null;
          directConnectionDispatcherId = null;

          // 重新启动响应超时计时器（如果之前有配置超时时间）
          // 注意：responseTimeoutId 在 catch 块开头已被清除，这里只需检查 responseTimeoutMs
          if (responseTimeoutMs > 0) {
            responseTimeoutId = setTimeout(() => {
              responseController.abort();
              logger.warn("ProxyForwarder: Response timeout after HTTP/1.1 fallback", {
                providerId: provider.id,
                providerName: provider.name,
                responseTimeoutMs,
              });
            }, responseTimeoutMs);
          }

          // 成功后跳过 throw，继续执行后续逻辑（不计入熔断器）
        } catch (http1Error) {
          // Release H1 fallback agent ref count before re-throwing
          if (http1ProxyConfig?.cacheKey && http1ProxyConfig?.dispatcherId) {
            getGlobalAgentPool().releaseAgent(
              http1ProxyConfig.cacheKey,
              http1ProxyConfig.dispatcherId
            );
          }

          // HTTP/1.1 也失败，记录并抛出原始错误
          logger.error("ProxyForwarder: HTTP/1.1 fallback also failed", {
            providerId: provider.id,
            providerName: provider.name,
            http1Error: http1Error instanceof Error ? http1Error.message : String(http1Error),
          });

          // 抛出 HTTP/1.1 错误，让正常的错误处理流程处理
          throw http1Error;
        }
      } else if (proxyConfig) {
        const isProxyError =
          err.message.includes("proxy") ||
          err.message.includes("ECONNREFUSED") ||
          err.message.includes("ENOTFOUND") ||
          err.message.includes("ETIMEDOUT");

        if (isProxyError) {
          logger.error("ProxyForwarder: Proxy connection failed", {
            providerId: provider.id,
            providerName: provider.name,
            proxyUrl: proxyConfig.proxyUrl,
            fallbackToDirect: proxyConfig.fallbackToDirect,
            errorType: err.constructor.name,
            errorMessage: err.message,
            errorCode: err.code,
          });

          // 如果配置了降级到直连，尝试不使用代理
          if (proxyConfig.fallbackToDirect) {
            logger.warn("ProxyForwarder: Falling back to direct connection", {
              providerId: provider.id,
              providerName: provider.name,
            });

            // 创建新的配置对象，不包含 dispatcher
            const fallbackInit = { ...init };
            delete fallbackInit.dispatcher;
            try {
              response = useErrorTolerantFetch
                ? await ProxyForwarder.fetchWithoutAutoDecode(
                    proxyUrl,
                    fallbackInit,
                    provider.id,
                    provider.name,
                    session,
                    deferDetailSnapshotPersistence
                  )
                : await fetch(proxyUrl, fallbackInit);
              logger.info("ProxyForwarder: Direct connection succeeded after proxy failure", {
                providerId: provider.id,
                providerName: provider.name,
              });

              // ⚠️ 关键：catch 入口已经释放了代理 agent 的 ref count（见本 catch 块顶部），
              // 而 fallback 后走的是"无 dispatcher 直连"，不再持有 agent pool 的引用。
              // 如果保留 proxyConfig，后续 session.releaseAgent 会对同一个 cacheKey 再减 1，
              // 把其他正在共享这个 agent 的请求计数吃掉，导致新连接被提前驱逐。
              // 此处必须同 H2→H1 fallback 一样清空跟踪信息。
              proxyConfig = null;
              directConnectionCacheKey = null;
              directConnectionDispatcherId = null;

              // 重新启动响应超时计时器（如果之前有配置超时时间）
              // 注意：responseTimeoutId 在 catch 块开头已被清除，这里只需检查 responseTimeoutMs
              if (responseTimeoutMs > 0) {
                responseTimeoutId = setTimeout(() => {
                  responseController.abort();
                  logger.warn("ProxyForwarder: Response timeout after direct fallback", {
                    providerId: provider.id,
                    providerName: provider.name,
                    responseTimeoutMs,
                  });
                }, responseTimeoutMs);
              }
              // 成功后跳过 throw，继续执行后续逻辑
            } catch (directError) {
              // 直连也失败，抛出原始错误
              logger.error("ProxyForwarder: Direct connection also failed", {
                providerId: provider.id,
                error: directError,
              });
              throw fetchError; // 抛出原始代理错误
            }
          } else {
            // 不降级，直接抛出代理错误
            throw new ProxyError("Service temporarily unavailable", 503);
          }
        } else {
          // 非代理相关错误，记录详细信息后抛出
          logger.error("ProxyForwarder: Fetch failed (with proxy configured)", {
            providerId: provider.id,
            providerName: provider.name,
            proxyUrl: new URL(proxyUrl).origin, // 只记录域名，隐藏查询参数和 API Key

            errorType: err.constructor.name,
            errorName: err.name,
            errorMessage: err.message,
            errorCode: err.code, // ⭐ 如 'ENOTFOUND'（DNS失败）、'ECONNREFUSED'（连接拒绝）、'ETIMEDOUT'（超时）、'ECONNRESET'（连接重置）
            errorSyscall: err.syscall, // ⭐ 如 'getaddrinfo'（DNS查询）、'connect'（TCP连接）
            errorErrno: err.errno,
            errorCause: err.cause,
            // ⭐ 增强诊断：undici 参数验证错误的具体说明
            errorCauseMessage: (err.cause as Error | undefined)?.message,
            errorCauseStack: (err.cause as Error | undefined)?.stack
              ?.split("\n")
              .slice(0, 2)
              .join("\n"),
            errorStack: err.stack?.split("\n").slice(0, 3).join("\n"), // 前3行堆栈

            targetUrl: proxyUrl, // 完整目标 URL（用于调试）
            headerKeys: Array.from(processedHeaders.keys()),
            headerCount: Array.from(processedHeaders.keys()).length,
            invalidHeaders: Array.from(processedHeaders.entries())
              .filter(([_, v]) => v === undefined || v === null || v === "")
              .map(([k]) => k),

            // 请求上下文
            method: session.method,
            hasBody: !!requestBody,
            bodySize: requestBody ? JSON.stringify(requestBody).length : 0,
          });

          throw fetchError;
        }
      } else {
        // 未使用代理，原有错误处理逻辑
        logger.error("ProxyForwarder: Fetch failed", {
          providerId: provider.id,
          providerName: provider.name,
          proxyUrl: new URL(proxyUrl).origin, // 只记录域名，隐藏查询参数和 API Key

          // ⭐ 详细错误信息（关键诊断字段）
          errorType: err.constructor.name,
          errorName: err.name,
          errorMessage: err.message,
          errorCode: err.code, // ⭐ 如 'ENOTFOUND'（DNS失败）、'ECONNREFUSED'（连接拒绝）、'ETIMEDOUT'（超时）、'ECONNRESET'（连接重置）
          errorSyscall: err.syscall, // ⭐ 如 'getaddrinfo'（DNS查询）、'connect'（TCP连接）
          errorErrno: err.errno,
          errorCause: err.cause,
          // ⭐ 增强诊断：undici 参数验证错误的具体说明
          errorCauseMessage: (err.cause as Error | undefined)?.message,
          errorCauseStack: (err.cause as Error | undefined)?.stack
            ?.split("\n")
            .slice(0, 2)
            .join("\n"),
          errorStack: err.stack?.split("\n").slice(0, 3).join("\n"), // 前3行堆栈

          targetUrl: proxyUrl, // 完整目标 URL（用于调试）
          headerKeys: Array.from(processedHeaders.keys()),
          headerCount: Array.from(processedHeaders.keys()).length,
          invalidHeaders: Array.from(processedHeaders.entries())
            .filter(([_, v]) => v === undefined || v === null || v === "")
            .map(([k]) => k),

          // 请求上下文
          method: session.method,
          hasBody: !!requestBody,
          bodySize: requestBody ? JSON.stringify(requestBody).length : 0,
        });

        throw fetchError;
      }
    }

    // 检查 HTTP 错误状态（4xx/5xx 均视为失败，触发重试）
    // 注意：用户要求所有 4xx 都重试，包括 401、403、429 等
    if (!response.ok) {
      // ⚠️ HTTP 错误：不要在读取响应体之前清除响应超时定时器
      // 原因：某些上游会在返回 4xx/5xx 后”卡住不结束 body”，
      // 若提前 clearTimeout，会导致 ProxyError.fromUpstreamResponse() 的 response.text() 无限等待，
      // 从而让整条请求链路（含客户端）悬挂，前端表现为一直”请求中”。
      //
      // 正确策略：保留 response timeout 继续监控 body 读取，并在 finally 里清理定时器。
      try {
        throw await ProxyError.fromUpstreamResponse(response, {
          id: provider.id,
          name: provider.name,
        });
      } finally {
        if (responseTimeoutId) {
          clearTimeout(responseTimeoutId);
        }
        // Release agent ref count (response-handler will never run for error responses)
        const errorReleaseKey = proxyConfig?.cacheKey ?? directConnectionCacheKey;
        const errorReleaseDispatcherId = proxyConfig?.dispatcherId ?? directConnectionDispatcherId;
        if (errorReleaseKey && errorReleaseDispatcherId) {
          getGlobalAgentPool().releaseAgent(errorReleaseKey, errorReleaseDispatcherId);
        }
      }
    }

    // 将响应超时清理函数和 controller 引用附加到 session，供 response-handler 使用
    // response-handler 会在读到首字节（流式）或完整响应（非流式）后调用此函数
    const sessionWithTimeout = session as ProxySession & {
      clearResponseTimeout?: () => void;
      responseController?: AbortController;
      releaseAgent?: () => void;
    };

    sessionWithTimeout.clearResponseTimeout = () => {
      if (responseTimeoutId) {
        clearTimeout(responseTimeoutId);
      }
      logger.debug("ProxyForwarder: Response timeout cleared by response-handler", {
        providerId: provider.id,
        responseTimeoutMs,
        responseTimeoutType,
      });
    };

    // 传递 responseController 引用，让 response-handler 能区分超时和客户端中断
    sessionWithTimeout.responseController = responseController;

    // Attach agent release callback for in-flight reference counting.
    // response-handler must call this in its finally block after the stream is fully consumed.
    const agentCacheKeyToRelease = proxyConfig?.cacheKey ?? directConnectionCacheKey;
    const agentDispatcherIdToRelease = proxyConfig?.dispatcherId ?? directConnectionDispatcherId;
    if (agentCacheKeyToRelease && agentDispatcherIdToRelease) {
      const pool = getGlobalAgentPool();
      sessionWithTimeout.releaseAgent = () => {
        pool.releaseAgent(agentCacheKeyToRelease, agentDispatcherIdToRelease);
      };
    }

    return response;
  }

  /**
   * 选择替代供应商（排除所有已失败的供应商）
   */
  private static async selectAlternative(
    session: ProxySession,
    excludeProviderIds: number[] // 改为数组，排除所有失败的供应商
  ): Promise<typeof session.provider | null> {
    // 使用公开的选择方法，传入排除列表
    const alternativeProvider = await ProxyProviderResolver.pickRandomProviderWithExclusion(
      session,
      excludeProviderIds
    );

    if (!alternativeProvider) {
      logger.warn("ProxyForwarder: No alternative provider available", {
        excludedProviders: excludeProviderIds,
      });
      return null;
    }

    // 确保不是已失败的供应商之一
    if (excludeProviderIds.includes(alternativeProvider.id)) {
      logger.error("ProxyForwarder: Selector returned excluded provider", {
        providerId: alternativeProvider.id,
        message: "This should not happen",
      });
      return null;
    }

    return alternativeProvider;
  }

  private static shouldUseStreamingHedge(session: ProxySession): boolean {
    const endpointPolicy = session.getEndpointPolicy?.();
    return (
      (endpointPolicy?.allowRetry ?? true) &&
      (endpointPolicy?.allowProviderSwitch ?? true) &&
      (session.request.message as Record<string, unknown>).stream === true &&
      (session.provider?.firstByteTimeoutStreamingMs ?? 0) > 0
    );
  }

  private static async sendStreamingWithHedge(session: ProxySession): Promise<Response> {
    const initialProvider = session.provider;
    if (!initialProvider) {
      throw new Error("代理上下文缺少供应商");
    }

    const launchedProviderIds = new Set<number>();
    let launchedProviderCount = 0;
    let settled = false;
    let winnerCommitted = false;
    let noMoreProviders = false;
    let launchingAlternative: Promise<void> | null = null;
    let lastError: Error | null = null;
    let lastErrorCategory: ErrorCategory | null = null;
    const attempts = new Set<StreamingHedgeAttempt>();

    let resolveResult: ((result: { response?: Response; error?: Error }) => void) | null = null;
    const resultPromise = new Promise<{ response?: Response; error?: Error }>((resolve) => {
      resolveResult = resolve;
    });

    const settleSuccess = (response: Response) => {
      if (settled) return;
      settled = true;
      resolveResult?.({ response });
    };

    const settleFailure = async (error: Error) => {
      if (settled) return;
      settled = true;
      await ProxyForwarder.clearSessionProviderBinding(session);
      resolveResult?.({ error });
    };

    const getAttemptModelRedirect = (attempt: StreamingHedgeAttempt) => {
      if (attempt.modelRedirect !== undefined) {
        return attempt.modelRedirect;
      }

      const redirect = attempt.session.getCurrentModelRedirect(attempt.provider.id);
      if (redirect) {
        attempt.modelRedirect = structuredClone(redirect);
      }

      return attempt.modelRedirect;
    };

    const abortAttempt = (attempt: StreamingHedgeAttempt, reason: string) => {
      if (attempt.settled) return;
      attempt.settled = true;
      if (attempt.thresholdTimer) {
        clearTimeout(attempt.thresholdTimer);
        attempt.thresholdTimer = null;
      }
      attempts.delete(attempt);
      if (reason === "hedge_loser") {
        session.addProviderToChain(attempt.provider, {
          ...attempt.endpointAudit,
          reason: "hedge_loser_cancelled",
          attemptNumber: attempt.sequence,
          modelRedirect: getAttemptModelRedirect(attempt),
        });
      }
      try {
        attempt.responseController?.abort(new Error(reason));
      } catch (abortError) {
        logger.debug("ProxyForwarder: hedge attempt abort failed", {
          error: abortError instanceof Error ? abortError.message : String(abortError),
          reason,
          sessionId: attempt.session.sessionId ?? null,
          providerId: attempt.provider.id,
          providerName: attempt.provider.name,
        });
      }
      const readerCancel = attempt.reader?.cancel();
      readerCancel?.catch((cancelError) => {
        logger.debug("ProxyForwarder: hedge attempt reader cancel failed", {
          error: cancelError instanceof Error ? cancelError.message : String(cancelError),
          reason,
          sessionId: attempt.session.sessionId ?? null,
          providerId: attempt.provider.id,
          providerName: attempt.provider.name,
        });
      });
    };

    const armAttemptThreshold = (attempt: StreamingHedgeAttempt) => {
      if (attempt.thresholdTimer) {
        clearTimeout(attempt.thresholdTimer);
        attempt.thresholdTimer = null;
      }
      attempt.thresholdTriggered = false;

      if (attempt.firstByteTimeoutMs <= 0) return;

      attempt.thresholdTimer = setTimeout(() => {
        if (settled || attempt.settled || attempt.thresholdTriggered) return;
        attempt.thresholdTriggered = true;
        session.addProviderToChain(attempt.provider, {
          ...attempt.endpointAudit,
          reason: "hedge_triggered",
          attemptNumber: attempt.sequence,
          circuitState: getCircuitState(attempt.provider.id),
        });
        void launchAlternative();
      }, attempt.firstByteTimeoutMs);
    };

    const abortAllAttempts = (winner?: StreamingHedgeAttempt, reason: string = "hedge_loser") => {
      for (const attempt of Array.from(attempts)) {
        if (winner && attempt === winner) continue;
        abortAttempt(attempt, reason);
      }
    };

    const finishIfExhausted = async () => {
      if (!settled && noMoreProviders && attempts.size === 0) {
        await settleFailure(ProxyForwarder.resolveHedgeTerminalError(lastError, lastErrorCategory));
      }
    };

    const launchAlternative = async () => {
      if (settled || winnerCommitted || noMoreProviders) return;
      if (launchingAlternative) {
        await launchingAlternative;
        return;
      }

      launchingAlternative = (async () => {
        const alternativeProvider = await ProxyForwarder.selectAlternative(
          session,
          Array.from(launchedProviderIds)
        );
        if (!alternativeProvider) {
          noMoreProviders = true;
          // No alternative providers available — let in-flight attempt(s) continue.
          // If all attempts already completed, settle with last error.
          if (attempts.size === 0) {
            await finishIfExhausted();
          }
          return;
        }

        await startAttempt(alternativeProvider, false);
      })()
        .catch(async (error) => {
          const normalizedError = error instanceof Error ? error : new Error(String(error));

          logger.error("ProxyForwarder: Hedge failed to launch alternative provider", {
            error: normalizedError,
            sessionId: session.sessionId ?? null,
            providerId: initialProvider.id,
            providerName: initialProvider.name,
          });

          lastError = ProxyForwarder.buildAllProvidersUnavailableError();
          lastErrorCategory = null;
          noMoreProviders = true;
          abortAllAttempts(undefined, "hedge_launch_failed");
          await finishIfExhausted();
        })
        .finally(() => {
          launchingAlternative = null;
        });

      await launchingAlternative;
    };

    const runAttempt = (attempt: StreamingHedgeAttempt) => {
      const providerForRequest =
        attempt.firstByteTimeoutMs > 0
          ? { ...attempt.provider, firstByteTimeoutStreamingMs: 0 }
          : attempt.provider;

      void ProxyForwarder.doForward(
        attempt.session,
        providerForRequest,
        attempt.baseUrl,
        attempt.endpointAudit,
        attempt.requestAttemptCount,
        true
      )
        .then(async (response) => {
          if (settled || winnerCommitted || attempt.settled) {
            const attemptRuntime = attempt.session as ProxySessionWithAttemptRuntime;
            try {
              attemptRuntime.responseController?.abort(new Error("hedge_loser"));
            } catch (abortError) {
              logger.debug("ProxyForwarder: hedge loser abort failed", {
                error: abortError instanceof Error ? abortError.message : String(abortError),
                sessionId: attempt.session.sessionId ?? null,
                providerId: attempt.provider.id,
                providerName: attempt.provider.name,
              });
            }
            const cancelPromise = response.body?.cancel("hedge_loser");
            cancelPromise?.catch((cancelError) => {
              logger.debug("ProxyForwarder: hedge loser body cancel failed", {
                error: cancelError instanceof Error ? cancelError.message : String(cancelError),
                sessionId: attempt.session.sessionId ?? null,
                providerId: attempt.provider.id,
                providerName: attempt.provider.name,
              });
            });
            return;
          }

          const attemptRuntime = attempt.session as ProxySessionWithAttemptRuntime;
          attempt.responseController = attemptRuntime.responseController ?? null;
          attempt.clearResponseTimeout = attemptRuntime.clearResponseTimeout ?? null;
          attempt.clearResponseTimeout?.();
          attempt.response = response;

          if (!response.body) {
            await handleAttemptFailure(
              attempt,
              new EmptyResponseError(attempt.provider.id, attempt.provider.name, "empty_body")
            );
            return;
          }

          attempt.reader = response.body.getReader();

          try {
            const firstChunk = await ProxyForwarder.readFirstReadableChunk(attempt.reader);
            if (firstChunk.done) {
              await handleAttemptFailure(
                attempt,
                new EmptyResponseError(attempt.provider.id, attempt.provider.name, "empty_body")
              );
              return;
            }

            await commitWinner(attempt, firstChunk.value);
          } catch (firstChunkError) {
            const normalizedError =
              firstChunkError instanceof Error
                ? firstChunkError
                : new Error(String(firstChunkError));
            if (settled || winnerCommitted) return;
            await handleAttemptFailure(attempt, normalizedError);
          }
        })
        .catch(async (attemptError) => {
          const normalizedError =
            attemptError instanceof Error ? attemptError : new Error(String(attemptError));
          if (settled || winnerCommitted) return;
          await handleAttemptFailure(attempt, normalizedError);
        });
    };

    const handleAttemptFailure = async (attempt: StreamingHedgeAttempt, error: Error) => {
      if (settled || winnerCommitted || attempt.settled) return;

      lastError = error;

      let errorCategory = await categorizeErrorAsync(error);
      lastErrorCategory = errorCategory;
      const statusCode = error instanceof ProxyError ? error.statusCode : undefined;
      const errorMessage =
        error instanceof ProxyError ? error.getDetailedErrorMessage() : error.message;
      let matchedRule: MatchedRuleDetails | undefined;
      let matchedRuleLogContext: Record<string, unknown> = {};

      if (attempt.endpointAudit.endpointId != null) {
        const isTimeoutError = error instanceof ProxyError && error.statusCode === 524;
        if (isTimeoutError || errorCategory === ErrorCategory.SYSTEM_ERROR) {
          await recordEndpointFailure(attempt.endpointAudit.endpointId, error);
        }
      }

      if (errorCategory === ErrorCategory.CLIENT_ABORT) {
        attempt.settled = true;
        if (attempt.thresholdTimer) {
          clearTimeout(attempt.thresholdTimer);
          attempt.thresholdTimer = null;
        }
        attempts.delete(attempt);

        session.addProviderToChain(attempt.provider, {
          ...attempt.endpointAudit,
          reason: "client_abort",
          attemptNumber: attempt.sequence,
          errorMessage: "Client aborted request",
          circuitState: getCircuitState(attempt.provider.id),
          modelRedirect: getAttemptModelRedirect(attempt),
        });
        abortAllAttempts(undefined, "client_abort");
        await settleFailure(
          error instanceof ProxyError
            ? error
            : new ProxyError("Request aborted by client", 499, undefined, true)
        );
        return;
      }

      const reactiveRectifierResult = await tryApplyReactiveAnthropicRectifier({
        provider: attempt.provider,
        requestSession: attempt.session,
        persistSession: session,
        errorMessage,
        attemptNumber: attempt.requestAttemptCount,
        retryAttemptNumber: attempt.requestAttemptCount + 1,
        retryState: attempt.reactiveRectifierRetryState,
      });

      if (reactiveRectifierResult.matched) {
        if (!reactiveRectifierResult.applied) {
          if (reactiveRectifierResult.reason === "not_applicable") {
            logger.info(
              `ProxyForwarder: ${getReactiveRectifierDisplayName(
                reactiveRectifierResult.rectifierType
              )} not applicable in hedge, skipping retry`,
              {
                providerId: attempt.provider.id,
                providerName: attempt.provider.name,
                trigger: reactiveRectifierResult.trigger,
                participantSequence: attempt.sequence,
                attemptNumber: attempt.requestAttemptCount,
              }
            );
          }

          errorCategory = ErrorCategory.NON_RETRYABLE_CLIENT_ERROR;
          lastErrorCategory = errorCategory;
        } else {
          logger.info(
            `ProxyForwarder: ${getReactiveRectifierDisplayName(
              reactiveRectifierResult.rectifierType
            )} applied in hedge, retrying same provider`,
            {
              providerId: attempt.provider.id,
              providerName: attempt.provider.name,
              trigger: reactiveRectifierResult.trigger,
              participantSequence: attempt.sequence,
              attemptNumber: attempt.requestAttemptCount,
              willRetryAttemptNumber: attempt.requestAttemptCount + 1,
            }
          );

          session.addProviderToChain(attempt.provider, {
            ...buildRetryFailedChainEntry(
              attempt.provider,
              attempt.endpointAudit,
              attempt.requestAttemptCount,
              error,
              errorMessage,
              reactiveRectifierResult.requestDetailsBeforeRectify
            ),
            modelRedirect: getAttemptModelRedirect(attempt),
          });

          if (attempt.thresholdTimer) {
            clearTimeout(attempt.thresholdTimer);
            attempt.thresholdTimer = null;
          }
          attempt.requestAttemptCount += 1;
          armAttemptThreshold(attempt);
          runAttempt(attempt);
          return;
        }
      }

      if (errorCategory === ErrorCategory.NON_RETRYABLE_CLIENT_ERROR) {
        matchedRule = buildMatchedRuleDetails(await getErrorDetectionResultAsync(error));
        matchedRuleLogContext = buildMatchedRuleLogContext(matchedRule);

        logger.warn("ProxyForwarder: Non-retryable client error in hedge, aborting all attempts", {
          providerId: attempt.provider.id,
          providerName: attempt.provider.name,
          statusCode,
          error: errorMessage,
          participantSequence: attempt.sequence,
          attemptNumber: attempt.requestAttemptCount,
          ...matchedRuleLogContext,
        });
      }

      attempt.settled = true;
      if (attempt.thresholdTimer) {
        clearTimeout(attempt.thresholdTimer);
        attempt.thresholdTimer = null;
      }
      attempts.delete(attempt);

      if (errorCategory === ErrorCategory.PROVIDER_ERROR && statusCode !== 404) {
        await recordFailure(attempt.provider.id, error);
      }

      session.addProviderToChain(
        attempt.provider,
        errorCategory === ErrorCategory.NON_RETRYABLE_CLIENT_ERROR
          ? {
              ...buildClientErrorChainEntry(
                attempt.provider,
                attempt.endpointAudit,
                attempt.sequence,
                error,
                errorMessage,
                buildRequestDetails(session),
                matchedRule
              ),
              modelRedirect: getAttemptModelRedirect(attempt),
            }
          : {
              ...attempt.endpointAudit,
              reason:
                errorCategory === ErrorCategory.RESOURCE_NOT_FOUND
                  ? "resource_not_found"
                  : "retry_failed",
              attemptNumber: attempt.sequence,
              statusCode,
              errorMessage,
              circuitState: getCircuitState(attempt.provider.id),
              modelRedirect: getAttemptModelRedirect(attempt),
            }
      );

      if (errorCategory === ErrorCategory.NON_RETRYABLE_CLIENT_ERROR) {
        abortAllAttempts(undefined, "client_error_non_retryable");
        await settleFailure(error);
        return;
      }

      await launchAlternative();
      await finishIfExhausted();
    };

    const commitWinner = async (attempt: StreamingHedgeAttempt, firstChunk: Uint8Array) => {
      if (settled || winnerCommitted || attempt.settled || !attempt.response || !attempt.reader)
        return;

      winnerCommitted = true;

      if (attempt.thresholdTimer) {
        clearTimeout(attempt.thresholdTimer);
        attempt.thresholdTimer = null;
      }

      attempt.settled = true;
      attempts.delete(attempt);

      for (const activeAttempt of attempts) {
        getAttemptModelRedirect(activeAttempt);
      }

      if (attempt.session !== session) {
        ProxyForwarder.syncWinningAttemptSession(session, attempt.session);
      }
      const detailSnapshotSession = attempt.session as ProxySessionWithDetailSnapshotRuntime;
      void persistRequestAfterSnapshot(session, detailSnapshotSession.detailSnapshotRequestAfter);
      void persistResponseBeforeSnapshot(
        session,
        detailSnapshotSession.detailSnapshotResponseBefore
      );
      session.setProvider(attempt.provider);

      // Determine if this is truly a hedge winner or just a regular success
      // Only mark as hedge_winner when an actual hedge race occurred
      // Note: launchedProviderCount is the most reliable indicator - if > 1, multiple providers were launched
      const isActualHedgeWin = launchedProviderCount > 1;

      session.addProviderToChain(attempt.provider, {
        ...attempt.endpointAudit,
        reason: isActualHedgeWin ? "hedge_winner" : "request_success",
        attemptNumber: attempt.sequence,
        statusCode: attempt.response.status,
        modelRedirect: getAttemptModelRedirect(attempt),
      });

      abortAllAttempts(attempt, "hedge_loser");

      if (session.sessionId) {
        void (async () => {
          const bindingResult = await SessionManager.updateSessionBindingSmart(
            session.sessionId!,
            attempt.provider.id,
            attempt.provider.priority || 0,
            launchedProviderCount === 1 && attempt.provider.id === initialProvider.id,
            attempt.provider.id !== initialProvider.id
          );

          if (bindingResult.updated) {
            logger.info("ProxyForwarder: Hedge winner binding updated", {
              sessionId: session.sessionId,
              providerId: attempt.provider.id,
              providerName: attempt.provider.name,
              reason: bindingResult.reason,
              details: bindingResult.details,
            });
          }

          if (session.shouldTrackSessionObservability()) {
            await SessionManager.updateSessionProvider(session.sessionId!, {
              providerId: attempt.provider.id,
              providerName: attempt.provider.name,
            });
          }
        })().catch((bindingError) => {
          logger.error("ProxyForwarder: Failed to update session provider info for hedge winner", {
            error: bindingError,
          });
        });
      }

      setDeferredStreamingFinalization(session, {
        providerId: attempt.provider.id,
        providerName: attempt.provider.name,
        providerPriority: attempt.provider.priority || 0,
        attemptNumber: attempt.sequence,
        totalProvidersAttempted: launchedProviderCount,
        isFirstAttempt: launchedProviderCount === 1 && attempt.provider.id === initialProvider.id,
        isFailoverSuccess: attempt.provider.id !== initialProvider.id,
        endpointId: attempt.endpointAudit.endpointId,
        endpointUrl: attempt.endpointAudit.endpointUrl,
        upstreamStatusCode: attempt.response.status,
        isHedgeWinner: isActualHedgeWin,
      });

      const response = new Response(
        ProxyForwarder.buildBufferedFirstChunkStream(firstChunk, attempt.reader),
        {
          status: attempt.response.status,
          statusText: attempt.response.statusText,
          headers: attempt.response.headers,
        }
      );

      settleSuccess(response);
    };

    const startAttempt = async (provider: Provider, useOriginalSession: boolean) => {
      if (settled || winnerCommitted || launchedProviderIds.has(provider.id)) return;

      launchedProviderIds.add(provider.id);

      let endpointSelection: {
        endpointId: number | null;
        baseUrl: string;
        endpointUrl: string;
      };
      try {
        endpointSelection = await ProxyForwarder.resolveStreamingHedgeEndpoint(session, provider);
      } catch (endpointError) {
        lastError = endpointError as Error;
        lastErrorCategory = null;
        await launchAlternative();
        await finishIfExhausted();
        return;
      }

      launchedProviderCount += 1;

      const attemptSession = useOriginalSession
        ? session
        : ProxyForwarder.createStreamingShadowSession(session, provider);
      attemptSession.setProvider(provider);

      const attempt: StreamingHedgeAttempt = {
        provider,
        session: attemptSession,
        baseUrl: endpointSelection.baseUrl,
        endpointAudit: {
          endpointId: endpointSelection.endpointId,
          endpointUrl: endpointSelection.endpointUrl,
        },
        responseController: null,
        clearResponseTimeout: null,
        firstByteTimeoutMs:
          provider.firstByteTimeoutStreamingMs > 0 ? provider.firstByteTimeoutStreamingMs : 0,
        sequence: launchedProviderCount,
        requestAttemptCount: 1,
        reactiveRectifierRetryState: {
          thinkingSignatureRetried: false,
          thinkingBudgetRetried: false,
        },
        settled: false,
        thresholdTriggered: false,
        thresholdTimer: null,
        reader: null,
        response: null,
      };

      attempts.add(attempt);

      // Record hedge participant launch in decision chain
      // (first provider is already recorded via initial_selection or session_reuse)
      if (launchedProviderCount > 1) {
        session.addProviderToChain(provider, {
          ...attempt.endpointAudit,
          reason: "hedge_launched",
          attemptNumber: attempt.sequence,
          circuitState: getCircuitState(provider.id),
        });
      }

      armAttemptThreshold(attempt);

      runAttempt(attempt);
    };

    if (session.clientAbortSignal) {
      session.clientAbortSignal.addEventListener(
        "abort",
        () => {
          if (settled || winnerCommitted) return;
          noMoreProviders = true;
          lastError = new ProxyError("Request aborted by client", 499, undefined, true);
          lastErrorCategory = ErrorCategory.CLIENT_ABORT;
          for (const attempt of Array.from(attempts)) {
            if (!attempt.settled) {
              session.addProviderToChain(attempt.provider, {
                ...attempt.endpointAudit,
                reason: "client_abort",
                attemptNumber: attempt.sequence,
                errorMessage: "Client aborted request",
                modelRedirect: getAttemptModelRedirect(attempt),
              });
            }
          }
          abortAllAttempts(undefined, "client_abort");
          void finishIfExhausted();
        },
        { once: true }
      );
    }

    await startAttempt(initialProvider, true);
    await finishIfExhausted();
    const result = await resultPromise;
    if (result.error) {
      throw result.error;
    }
    return result.response as Response;
  }

  private static async resolveStreamingHedgeEndpoint(
    session: ProxySession,
    provider: Provider
  ): Promise<{ endpointId: number | null; baseUrl: string; endpointUrl: string }> {
    const requestPath = session.requestUrl.pathname;
    const providerVendorId = provider.providerVendorId ?? 0;
    const isMcpRequest =
      provider.providerType !== "gemini" &&
      provider.providerType !== "gemini-cli" &&
      !isStandardProxyEndpointPath(requestPath);
    const shouldEnforceStrictEndpointPool =
      !isMcpRequest && isStrictStandardEndpointPath(requestPath) && providerVendorId > 0;

    if (
      !isMcpRequest &&
      provider.providerVendorId &&
      (await isVendorTypeCircuitOpen(provider.providerVendorId, provider.providerType))
    ) {
      throw new ProxyError("Vendor-type circuit is open", 503, {
        body: "",
        providerId: provider.id,
        providerName: provider.name,
      });
    }

    const endpointCandidates: Array<{ endpointId: number | null; endpointUrl: string }> = [];
    let endpointSelectionError: Error | null = null;

    if (isMcpRequest) {
      const sanitizedUrl = sanitizeUrl(provider.url);
      endpointCandidates.push({ endpointId: null, endpointUrl: sanitizedUrl });
      return { endpointId: null, baseUrl: provider.url, endpointUrl: sanitizedUrl };
    }

    if (providerVendorId > 0) {
      try {
        const preferred = await getPreferredProviderEndpoints({
          vendorId: providerVendorId,
          providerType: provider.providerType,
        });
        endpointCandidates.push(
          ...preferred.map((endpoint) => ({ endpointId: endpoint.id, endpointUrl: endpoint.url }))
        );
      } catch (error) {
        endpointSelectionError = error instanceof Error ? error : new Error(String(error));
      }
    }

    if (endpointCandidates.length === 0) {
      if (shouldEnforceStrictEndpointPool) {
        session.addProviderToChain(provider, {
          reason: "endpoint_pool_exhausted",
          attemptNumber: 1,
          strictBlockCause: endpointSelectionError ? "selector_error" : "no_endpoint_candidates",
          errorMessage: endpointSelectionError?.message,
        });

        if (endpointSelectionError) {
          logger.warn("[ProxyForwarder] Failed to load provider endpoints (strict pool)", {
            providerId: provider.id,
            vendorId: providerVendorId,
            providerType: provider.providerType,
            error: endpointSelectionError.message,
          });
        }

        throw new ProxyError("No available provider endpoints", 503, {
          body: "",
          providerId: provider.id,
          providerName: provider.name,
        });
      }

      const sanitizedUrl = sanitizeUrl(provider.url);
      return { endpointId: null, baseUrl: provider.url, endpointUrl: sanitizedUrl };
    }

    return {
      endpointId: endpointCandidates[0].endpointId,
      baseUrl: endpointCandidates[0].endpointUrl,
      endpointUrl: sanitizeUrl(endpointCandidates[0].endpointUrl),
    };
  }

  private static createStreamingShadowSession(
    session: ProxySession,
    provider: Provider
  ): ProxySession {
    const shadow = Object.assign(
      Object.create(Object.getPrototypeOf(session)) as ProxySession,
      session
    );
    const sourceState = session as unknown as {
      originalHeaders: Headers;
      providerChain: ProviderChainItem[];
      specialSettings: unknown[];
      originalModelName: string | null;
      originalUrlPathname: string | null;
      currentModelRedirect: {
        providerId: number;
        redirect: NonNullable<ProviderChainItem["modelRedirect"]>;
      } | null;
      providersSnapshot: Provider[] | null;
    };
    const shadowState = shadow as unknown as {
      request: ProxySession["request"];
      headers: Headers;
      originalHeaders: Headers;
      providerChain: ProviderChainItem[];
      specialSettings: unknown[];
      originalModelName: string | null;
      originalUrlPathname: string | null;
      currentModelRedirect: {
        providerId: number;
        redirect: NonNullable<ProviderChainItem["modelRedirect"]>;
      } | null;
      providersSnapshot: Provider[] | null;
    };

    shadowState.request = {
      ...session.request,
      message: structuredClone(session.request.message),
      buffer: session.request.buffer ? session.request.buffer.slice(0) : undefined,
      imageRequestMetadata: cloneOpenAIImageRequestMetadata(session.request.imageRequestMetadata),
    };
    shadow.requestUrl = new URL(session.requestUrl.toString());
    shadowState.headers = new Headers(session.headers);
    shadowState.originalHeaders = new Headers(sourceState.originalHeaders);
    shadowState.providerChain = [...sourceState.providerChain];
    shadowState.specialSettings = [...sourceState.specialSettings];
    shadowState.originalModelName = sourceState.originalModelName;
    shadowState.originalUrlPathname = sourceState.originalUrlPathname;
    shadowState.currentModelRedirect = sourceState.currentModelRedirect
      ? {
          providerId: sourceState.currentModelRedirect.providerId,
          redirect: structuredClone(sourceState.currentModelRedirect.redirect),
        }
      : null;
    shadowState.providersSnapshot = sourceState.providersSnapshot;
    shadow.setCacheTtlResolved(session.getCacheTtlResolved());
    shadow.setContext1mApplied(session.getContext1mApplied());
    shadow.forwardedRequestBody = null;
    shadow.sessionId = null;
    shadow.messageContext = null;
    shadow.setProvider(provider);

    return shadow;
  }

  private static syncWinningAttemptSession(target: ProxySession, source: ProxySession): void {
    target.request.message = source.request.message;
    target.request.buffer = source.request.buffer;
    target.request.log = source.request.log;
    target.request.note = source.request.note;
    target.request.model = source.request.model;
    target.request.imageRequestMetadata = cloneOpenAIImageRequestMetadata(
      source.request.imageRequestMetadata
    );
    target.requestUrl = new URL(source.requestUrl.toString());
    target.forwardedRequestBody = source.forwardedRequestBody;
    target.setCacheTtlResolved(source.getCacheTtlResolved());
    target.setContext1mApplied(source.getContext1mApplied());

    const sourceState = source as unknown as {
      providerChain: ProviderChainItem[];
      specialSettings: unknown[];
      originalModelName: string | null;
      originalUrlPathname: string | null;
      currentModelRedirect: {
        providerId: number;
        redirect: NonNullable<ProviderChainItem["modelRedirect"]>;
      } | null;
    };
    const targetState = target as unknown as {
      providerChain: ProviderChainItem[];
      specialSettings: unknown[];
      originalModelName: string | null;
      originalUrlPathname: string | null;
      currentModelRedirect: {
        providerId: number;
        redirect: NonNullable<ProviderChainItem["modelRedirect"]>;
      } | null;
      clearResponseTimeout?: () => void;
      responseController?: AbortController;
    };
    const sourceRuntime = source as ProxySessionWithAttemptRuntime;

    const mergedProviderChain = [...targetState.providerChain];
    for (const item of sourceState.providerChain) {
      const exists = mergedProviderChain.some(
        (existing) =>
          existing.id === item.id &&
          existing.timestamp === item.timestamp &&
          existing.reason === item.reason &&
          existing.attemptNumber === item.attemptNumber
      );
      if (!exists) {
        mergedProviderChain.push(item);
      }
    }
    targetState.providerChain = mergedProviderChain;
    // 合并 specialSettings，避免覆盖已有的 rectifier audit 记录
    const existingKeys = new Set(targetState.specialSettings.map((s) => JSON.stringify(s)));
    const merged = [...targetState.specialSettings];
    for (const setting of sourceState.specialSettings) {
      if (!existingKeys.has(JSON.stringify(setting))) {
        merged.push(setting);
      }
    }
    targetState.specialSettings = merged;
    targetState.originalModelName = sourceState.originalModelName;
    targetState.originalUrlPathname = sourceState.originalUrlPathname;
    targetState.currentModelRedirect = sourceState.currentModelRedirect
      ? {
          providerId: sourceState.currentModelRedirect.providerId,
          redirect: structuredClone(sourceState.currentModelRedirect.redirect),
        }
      : null;
    targetState.clearResponseTimeout = sourceRuntime.clearResponseTimeout;
    targetState.responseController = sourceRuntime.responseController;
  }

  private static async clearSessionProviderBinding(session: ProxySession): Promise<void> {
    if (!session.sessionId) return;
    await SessionManager.clearSessionProvider(session.sessionId);
  }

  private static buildAllProvidersUnavailableError(): ProxyError {
    return new ProxyError("所有供应商暂时不可用，请稍后重试", 503);
  }

  private static resolveHedgeTerminalError(
    lastError: Error | null,
    lastErrorCategory: ErrorCategory | null
  ): Error {
    if (
      lastError &&
      (lastErrorCategory === ErrorCategory.CLIENT_ABORT ||
        lastErrorCategory === ErrorCategory.NON_RETRYABLE_CLIENT_ERROR)
    ) {
      return lastError;
    }

    return ProxyForwarder.buildAllProvidersUnavailableError();
  }

  private static async readFirstReadableChunk(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        return result;
      }
      // Skip zero-length chunks: some upstream providers (e.g. behind proxies/load-balancers)
      // may emit empty chunks as keep-alive or framing artifacts. These carry no payload and
      // must be silently skipped to avoid treating them as a valid "first byte" event.
      if (result.value && result.value.byteLength > 0) {
        return result;
      }
    }
  }

  private static buildBufferedFirstChunkStream(
    firstChunk: Uint8Array,
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): ReadableStream<Uint8Array> {
    let firstChunkSent = false;

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!firstChunkSent) {
          firstChunkSent = true;
          controller.enqueue(firstChunk);
          return;
        }

        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        if (value && value.byteLength > 0) {
          controller.enqueue(value);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } catch {
          // ignore
        }
      },
    });
  }

  private static buildHeaders(
    session: ProxySession,
    provider: NonNullable<typeof session.provider>
  ): Headers {
    const outboundKey = provider.key;
    const preserveClientIp = provider.preserveClientIp ?? false;
    const { clientIp, xForwardedFor } = ProxyForwarder.resolveClientIp(session.headers);

    // 构建请求头覆盖规则
    const overrides: Record<string, string> = {
      host: HeaderProcessor.extractHost(provider.url),
      "content-type": "application/json", // 确保 Content-Type
      "accept-encoding": "identity", // 禁用压缩：避免 undici ZlibError（代理应透传原始数据）
    };

    if (provider.providerType === "claude-auth" || provider.providerType === "claude") {
      Object.assign(
        overrides,
        resolveAnthropicAuthHeaders(outboundKey, provider.url, {
          forceBearerOnly: provider.providerType === "claude-auth",
        })
      );
    }

    if (provider.providerType === "codex" || provider.providerType === "openai-compatible") {
      overrides.authorization = `Bearer ${outboundKey}`;
    }

    // Codex 特殊处理：优先使用过滤器修改的 User-Agent
    if (provider.providerType === "codex") {
      const filteredUA = session.headers.get("user-agent");
      const originalUA = session.userAgent;
      const wasModified = session.isHeaderModified("user-agent");

      // 优先级说明：
      // 1. 如果过滤器修改了 user-agent（wasModified=true），使用过滤后的值
      // 2. 如果过滤器删除了 user-agent（wasModified=true 但 filteredUA=null），回退到原始 UA
      // 3. 如果原始 UA 也不存在，使用硬编码兜底值
      // 注意：使用 ?? 而非 || 以确保空字符串 UA 能被正确保留
      let resolvedUA: string;
      if (wasModified) {
        resolvedUA = filteredUA ?? originalUA ?? DEFAULT_CODEX_USER_AGENT;
      } else {
        resolvedUA = originalUA ?? DEFAULT_CODEX_USER_AGENT;
      }
      overrides["user-agent"] = resolvedUA;

      logger.debug("ProxyForwarder: Codex provider User-Agent resolution", {
        wasModified,
        hasFilteredUA: !!filteredUA,
        hasOriginalUA: !!originalUA,
        finalValueLength: resolvedUA.length,
      });
    }

    if (preserveClientIp) {
      if (xForwardedFor) {
        overrides["x-forwarded-for"] = xForwardedFor;
      }
      if (clientIp) {
        overrides["x-real-ip"] = clientIp;
      }
    }

    // 针对 1h 缓存 TTL，补充 Anthropic beta header（避免客户端遗漏）
    if (session.getCacheTtlResolved && session.getCacheTtlResolved() === "1h") {
      const existingBeta = session.headers.get("anthropic-beta") || "";
      const betaFlags = new Set(
        existingBeta
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );
      betaFlags.add("extended-cache-ttl-2025-04-11");
      // 确保包含基础的 prompt-caching 标记
      if (betaFlags.size === 1) {
        betaFlags.add("prompt-caching-2024-07-31");
      }
      overrides["anthropic-beta"] = Array.from(betaFlags).join(", ");
    }

    const headerProcessor = HeaderProcessor.createForProxy({
      blacklist: [...OUTBOUND_TRANSPORT_HEADER_BLACKLIST, "x-api-key"],
      preserveClientIpHeaders: preserveClientIp,
      overrides,
    });

    return headerProcessor.process(session.headers);
  }
  private static buildGeminiHeaders(
    session: ProxySession,
    provider: NonNullable<typeof session.provider>,
    baseUrl: string,
    accessToken: string,
    isApiKey: boolean
  ): Headers {
    const preserveClientIp = provider.preserveClientIp ?? false;
    const { clientIp, xForwardedFor } = ProxyForwarder.resolveClientIp(session.headers);

    const overrides: Record<string, string> = {
      host: HeaderProcessor.extractHost(baseUrl),
      "content-type": "application/json",
      "accept-encoding": "identity",
      "user-agent": session.headers.get("user-agent") ?? session.userAgent ?? "claude-code-hub",
    };

    if (isApiKey) {
      overrides[GEMINI_PROTOCOL.HEADERS.API_KEY] = accessToken;
    } else {
      overrides.authorization = `Bearer ${accessToken}`;
    }

    if (provider.providerType === "gemini-cli") {
      overrides[GEMINI_PROTOCOL.HEADERS.API_CLIENT] = "GeminiCLI/1.0";
    }

    if (preserveClientIp) {
      if (xForwardedFor) {
        overrides["x-forwarded-for"] = xForwardedFor;
      }
      if (clientIp) {
        overrides["x-real-ip"] = clientIp;
      }
    }

    const headerProcessor = HeaderProcessor.createForProxy({
      blacklist: [
        ...OUTBOUND_TRANSPORT_HEADER_BLACKLIST,
        "x-api-key",
        GEMINI_PROTOCOL.HEADERS.API_KEY,
      ],
      preserveClientIpHeaders: preserveClientIp,
      overrides,
    });

    return headerProcessor.process(session.headers);
  }

  private static resolveClientIp(headers: Headers): {
    clientIp: string | null;
    xForwardedFor: string | null;
  } {
    const xffRaw = headers.get("x-forwarded-for");
    const xffParts =
      xffRaw
        ?.split(",")
        .map((ip) => ip.trim())
        .filter(Boolean) ?? [];

    const candidateIps = [
      ...xffParts,
      headers.get("x-real-ip")?.trim(),
      headers.get("x-client-ip")?.trim(),
      headers.get("x-originating-ip")?.trim(),
      headers.get("x-remote-ip")?.trim(),
      headers.get("x-remote-addr")?.trim(),
    ].filter((ip): ip is string => !!ip);

    const clientIp = candidateIps[0] ?? null;
    const xForwardedFor = xffParts.length > 0 ? xffParts.join(", ") : clientIp;

    return { clientIp, xForwardedFor: xForwardedFor ?? null };
  }

  /**
   * 使用 undici.request 绕过 fetch 的自动解压
   *
   * 原因：Node/undici 的 fetch 会自动根据 Content-Encoding 解压响应，且无法关闭。
   * 当上游服务器忽略 accept-encoding: identity 仍返回 gzip 时，如果 gzip 流被提前终止
   * （如连接关闭），undici 的 Gunzip 会抛出 "TypeError: terminated" 错误。
   *
   * 解决方案：使用 undici.request 获取未自动解压的原始流，手动用容错方式处理 gzip。
   */
  private static async fetchWithoutAutoDecode(
    url: string,
    init: RequestInit & { dispatcher?: Dispatcher },
    providerId: number,
    providerName: string,
    session?: ProxySession,
    deferDetailSnapshotPersistence: boolean = false
  ): Promise<Response> {
    const { FETCH_HEADERS_TIMEOUT: headersTimeout, FETCH_BODY_TIMEOUT: bodyTimeout } =
      getEnvConfig();

    logger.debug("ProxyForwarder: Using undici.request to bypass auto-decompression", {
      providerId,
      providerName,
      url: new URL(url).origin, // 只记录域名，隐藏路径和参数
      method: init.method,
      reason: "Using manual gzip handling to avoid terminated error",
    });

    // 将 Headers 对象转换为 Record<string, string>
    const headersObj: Record<string, string> = {};
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headersObj[key] = value;
      });
    } else if (init.headers && typeof init.headers === "object") {
      Object.assign(headersObj, init.headers);
    }

    // 使用 undici.request 获取未自动解压的响应
    // ⭐ 显式配置超时：确保使用自定义 dispatcher（如 SOCKS 代理）时也能正确应用超时
    const toUndiciBody = (
      body: BodyInit | null | undefined
    ): string | Uint8Array | Buffer | null | undefined => {
      if (body == null || typeof body === "string") return body;
      if (body instanceof Uint8Array) return body;
      if (Buffer.isBuffer(body)) return body;
      if (body instanceof ArrayBuffer) return new Uint8Array(body);
      if (ArrayBuffer.isView(body)) {
        return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
      }
      return undefined;
    };

    const undiciRes = await undiciRequest(url, {
      method: init.method as string,
      headers: headersObj,
      body: toUndiciBody(init.body),
      signal: init.signal,
      dispatcher: init.dispatcher,
      bodyTimeout,
      headersTimeout,
    });

    // ⭐ 立即为 undici body 添加错误处理，防止 uncaughtException
    // 必须在任何其他操作之前设置，否则 ECONNRESET 等错误会导致 uncaughtException
    const rawBody = undiciRes.body as Readable;
    rawBody.on("error", (err) => {
      logger.warn("ProxyForwarder: undici body stream error (caught early)", {
        providerId,
        providerName,
        error: err.message,
        errorCode: (err as NodeJS.ErrnoException).code,
      });
    });

    // 构建响应头
    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(undiciRes.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        value.forEach((v) => responseHeaders.append(key, v));
      } else {
        responseHeaders.append(key, value);
      }
    }

    if (session?.shouldPersistSessionDebugArtifacts()) {
      const detailSnapshotSession = session as ProxySessionWithDetailSnapshotRuntime;
      detailSnapshotSession.detailSnapshotResponseBefore = {
        headers: new Headers(responseHeaders),
        meta: {
          upstreamUrl: url,
          statusCode: undiciRes.statusCode,
        },
      };
    }

    if (session?.sessionId && session.shouldPersistSessionDebugArtifacts()) {
      void SessionManager.storeSessionResponseHeaders(
        session.sessionId,
        responseHeaders,
        session.requestSequence
      ).catch((err) => logger.error("Failed to store response headers:", err));

      void SessionManager.storeSessionUpstreamResponseMeta(
        session.sessionId,
        { url, statusCode: undiciRes.statusCode },
        session.requestSequence
      ).catch((err) => logger.error("Failed to store upstream response meta:", err));

      if (!deferDetailSnapshotPersistence) {
        void persistResponseBeforeSnapshot(
          session,
          (session as ProxySessionWithDetailSnapshotRuntime).detailSnapshotResponseBefore
        );
      }
    }

    // 检测响应是否为 gzip 压缩
    const encoding = responseHeaders.get("content-encoding")?.toLowerCase() || "";
    let bodyStream: ReadableStream<Uint8Array>;

    if (encoding.includes("gzip")) {
      logger.debug("ProxyForwarder: Response is gzip encoded, decompressing manually", {
        providerId,
        providerName,
        contentEncoding: encoding,
      });

      // 创建容错 Gunzip 解压器
      const gunzip = createGunzip({
        flush: zlibConstants.Z_SYNC_FLUSH,
        finishFlush: zlibConstants.Z_SYNC_FLUSH,
      });

      // 捕获 Gunzip 错误但不抛出（容错处理）
      gunzip.on("error", (err) => {
        logger.warn("ProxyForwarder: Gunzip decompression error (ignored)", {
          providerId,
          providerName,
          error: err.message,
          note: "Partial data may be returned, but no crash",
        });
        // 尝试结束流，避免挂起
        try {
          gunzip.end();
        } catch {
          // ignore
        }
      });

      // 将 undici body (Node Readable) pipe 到 Gunzip
      // 注意：使用前面已添加错误处理器的 rawBody
      rawBody.pipe(gunzip);

      // 将 Gunzip 流转换为 Web 流（容错版本）
      bodyStream = ProxyForwarder.nodeStreamToWebStreamSafe(gunzip, providerId, providerName);

      // 移除 content-encoding 和 content-length（避免下游再解压或使用错误长度）
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
    } else {
      // 非 gzip：直接转换 Node 流为 Web 流
      logger.debug("ProxyForwarder: Response is not gzip encoded, passing through", {
        providerId,
        providerName,
        contentEncoding: encoding || "(none)",
      });
      // 注意：使用前面已添加错误处理器的 rawBody
      bodyStream = ProxyForwarder.nodeStreamToWebStreamSafe(rawBody, providerId, providerName);
    }

    logger.debug("ProxyForwarder: undici.request completed, returning wrapped response", {
      providerId,
      providerName,
      statusCode: undiciRes.statusCode,
      hasGzip: encoding.includes("gzip"),
    });

    return new Response(bodyStream, {
      status: undiciRes.statusCode,
      // 未知/非标准状态码不应兜底为 OK（避免误导客户端日志与调试）
      statusText: STATUS_CODES[undiciRes.statusCode] ?? "",
      headers: responseHeaders,
    });
  }

  /**
   * 将 Node.js Readable 流转换为 Web ReadableStream（容错版本）
   *
   * 关键特性：吞掉上游流的错误事件，避免 "terminated" 错误冒泡到调用者
   */
  private static nodeStreamToWebStreamSafe(
    nodeStream: Readable,
    providerId: number,
    providerName: string
  ): ReadableStream<Uint8Array> {
    let chunkCount = 0;
    let totalBytes = 0;

    return new ReadableStream<Uint8Array>({
      start(controller) {
        logger.debug("ProxyForwarder: Starting Node-to-Web stream conversion", {
          providerId,
          providerName,
        });

        nodeStream.on("data", (chunk: Buffer | Uint8Array) => {
          chunkCount++;
          totalBytes += chunk.length;
          try {
            const buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            controller.enqueue(buf);
          } catch {
            // 如果 controller 已关闭，忽略
          }
        });

        nodeStream.on("end", () => {
          logger.debug("ProxyForwarder: Node stream ended normally", {
            providerId,
            providerName,
            chunkCount,
            totalBytes,
          });
          try {
            controller.close();
          } catch {
            // 如果已关闭，忽略
          }
        });

        nodeStream.on("close", () => {
          logger.debug("ProxyForwarder: Node stream closed", {
            providerId,
            providerName,
            chunkCount,
            totalBytes,
          });
          try {
            controller.close();
          } catch {
            // 如果已关闭，忽略
          }
        });

        // ⭐ 关键：将上游流错误传播到下游 reader，确保 ResponseHandler 能检测到截断
        nodeStream.on("error", (err) => {
          logger.warn("ProxyForwarder: Upstream stream error (signaling downstream)", {
            providerId,
            providerName,
            error: err.message,
            errorName: err.name,
          });
          try {
            controller.error(err);
          } catch {
            // 如果已关闭或已出错，忽略
          }
        });
      },

      cancel(reason) {
        try {
          nodeStream.destroy(
            reason instanceof Error ? reason : reason ? new Error(String(reason)) : undefined
          );
        } catch {
          // ignore
        }
      },
    });
  }
}
