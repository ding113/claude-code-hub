import { logger } from "@/lib/logger";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";
import { updateMessageRequestDetails, updateMessageRequestDuration } from "@/repository/message";
import type { ProviderType } from "@/types/provider";
import type { SystemSettings } from "@/types/system-config";
import { extractActualResponseModelForProvider } from "../actual-response-model";
import type { ClientFormat } from "../format-mapper";
import { ProxyForwarder } from "../forwarder";
import { parseUsageFromResponseText } from "../response-handler";
import type { ProxySession } from "../session";
import { isFakeStreamingEligible } from "./eligibility";
import type { OrchestrateResult } from "./orchestrator";
import type { ProtocolFamily } from "./response-validator";
import {
  type AttemptPerformer,
  buildFakeStreamingNonStreamResponse,
  buildFakeStreamingResponse,
  type FakeStreamingCompletionHook,
} from "./runner";
import { cloneRequestForInternalNonStreamAttempt, detectClientStreamIntent } from "./stream-intent";

const HEARTBEAT_INTERVAL_MS = 5000;
// The underlying ProxyForwarder runs its own multi-provider loop with fake-200
// detection and serial fallback. We only allow ONE invocation of that loop
// per fake-streaming request to avoid double-counting message context, cost,
// and provider chain. Edge cases that slip past the forwarder's fake-200
// detection (e.g., empty content array, comment-only SSE) end as 502 here
// instead of triggering a second forwarder pass.
const MAX_ATTEMPTS = 1;

function familyFromFormat(format: ClientFormat): ProtocolFamily | null {
  switch (format) {
    case "claude":
      return "anthropic";
    case "openai":
      return "openai-chat";
    case "response":
      return "openai-responses";
    case "gemini":
    case "gemini-cli":
      return "gemini";
    default:
      return null;
  }
}

/**
 * If the request is eligible for fake streaming, run the fake streaming flow
 * and return its Response. Otherwise return null so the caller can fall back
 * to the regular ProxyForwarder + ProxyResponseHandler path.
 */
export async function tryFakeStreamingPath(
  session: ProxySession,
  systemSettings: SystemSettings
): Promise<Response | null> {
  const clientModel = (session.request.model ?? "").toString();
  const providerGroup = session.provider?.groupTag ?? null;
  const eligible = isFakeStreamingEligible(
    clientModel,
    providerGroup,
    systemSettings.fakeStreamingWhitelist
  );
  if (!eligible) return null;

  const family = familyFromFormat(session.originalFormat);
  if (!family) return null;

  const isStream = detectClientStreamIntent({
    format: session.originalFormat,
    pathname: session.requestUrl.pathname,
    search: session.requestUrl.search,
    body: session.request.message,
  });

  // Convert the session request to a non-stream upstream attempt before the
  // forwarder runs. We never let upstream open a streaming response because
  // we need to fully buffer + validate before emitting anything.
  applyNonStreamMutation(session);

  const performAttempt = buildAttemptPerformer(session);
  if (session.clientAbortSignal === null) {
    // No client abort signal means heartbeat / orchestrator can't observe
    // client disconnect — surface the silent degradation in the log so it's
    // not invisible in edge-middleware / test environments where this happens.
    logger.warn("[FakeStreaming] session.clientAbortSignal is null; abort propagation disabled", {
      model: clientModel,
    });
  }
  const abortSignal = session.clientAbortSignal ?? new AbortController().signal;
  const onCompletion = buildCompletionHook(session);

  if (isStream) {
    logger.debug("[FakeStreaming] taking stream path", {
      model: clientModel,
      providerGroup,
      family,
    });
    return buildFakeStreamingResponse({
      family,
      isStream: true,
      performAttempt,
      abortSignal,
      maxAttempts: MAX_ATTEMPTS,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      onCompletion,
    });
  }

  logger.debug("[FakeStreaming] taking non-stream path", {
    model: clientModel,
    providerGroup,
    family,
  });
  return await buildFakeStreamingNonStreamResponse({
    family,
    performAttempt,
    abortSignal,
    maxAttempts: MAX_ATTEMPTS,
    onCompletion,
  });
}

/**
 * Build the lifecycle-completion hook that persists the terminal state of a
 * fake-streaming request. Fake streaming bypasses both ProxyResponseHandler
 * and ProxyErrorHandler, so without this hook the message_request row stays
 * with status_code=NULL / provider_chain=NULL forever and the proxy-status
 * tracker keeps the request in "in progress" state (see #1310).
 *
 * Mirrors the write set of ProxyResponseHandler success + ProxyErrorHandler
 * failure paths so the usage-log UI and the tracker converge to the same
 * terminal shape as the non-fake-streaming path.
 */
function buildCompletionHook(session: ProxySession): FakeStreamingCompletionHook {
  return async ({ result }) => {
    const messageContext = session.messageContext;
    if (!messageContext) return;

    const durationMs = Date.now() - session.startTime;
    const providerChain = session.getProviderChain();
    const currentModel = session.getCurrentModel() ?? undefined;
    const specialSettings = session.getSpecialSettings() ?? undefined;
    const provider = session.provider ?? null;
    const providerType = provider?.providerType;

    const { statusCode, errorMessage, usageDetails } = resolveTerminalOutcome({
      result,
      providerType,
    });

    try {
      await updateMessageRequestDuration(messageContext.id, durationMs);
    } catch (err) {
      logger.error("[FakeStreaming] Failed to persist request duration", {
        error: err,
        messageRequestId: messageContext.id,
      });
    }

    try {
      await updateMessageRequestDetails(messageContext.id, {
        statusCode,
        errorMessage: errorMessage ?? undefined,
        providerChain,
        model: currentModel,
        providerId: provider?.id,
        context1mApplied: session.getContext1mApplied(),
        swapCacheTtlApplied: provider?.swapCacheTtlBilling ?? false,
        specialSettings,
        ttfbMs: session.ttfbMs ?? durationMs,
        inputTokens: usageDetails?.inputTokens,
        outputTokens: usageDetails?.outputTokens,
        cacheCreationInputTokens: usageDetails?.cacheCreationInputTokens,
        cacheReadInputTokens: usageDetails?.cacheReadInputTokens,
        cacheCreation5mInputTokens: usageDetails?.cacheCreation5mInputTokens,
        cacheCreation1hInputTokens: usageDetails?.cacheCreation1hInputTokens,
        cacheTtlApplied: usageDetails?.cacheTtl ?? null,
        actualResponseModel: usageDetails?.actualResponseModel ?? undefined,
      });
    } catch (err) {
      logger.error("[FakeStreaming] Failed to persist terminal request details", {
        error: err,
        messageRequestId: messageContext.id,
      });
    }

    try {
      const tracker = ProxyStatusTracker.getInstance();
      tracker.endRequest(messageContext.user.id, messageContext.id);
    } catch (err) {
      logger.error("[FakeStreaming] Failed to end tracker request", {
        error: err,
        messageRequestId: messageContext.id,
      });
    }
  };
}

interface TerminalUsageDetails {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreation5mInputTokens?: number;
  cacheCreation1hInputTokens?: number;
  cacheTtl?: string | null;
  actualResponseModel?: string | null;
}

interface TerminalOutcome {
  statusCode: number;
  errorMessage: string | null;
  usageDetails: TerminalUsageDetails | null;
}

function resolveTerminalOutcome(input: {
  result: OrchestrateResult;
  providerType: ProviderType | undefined;
}): TerminalOutcome {
  const { result, providerType } = input;

  if (result.ok && typeof result.finalBody === "string") {
    let usageDetails: TerminalUsageDetails | null = null;
    try {
      const parsed = parseUsageFromResponseText(result.finalBody, providerType);
      const metrics = parsed.usageMetrics ?? null;
      const actualResponseModel = providerType
        ? extractActualResponseModelForProvider(providerType, false, result.finalBody)
        : null;
      usageDetails = {
        inputTokens: metrics?.input_tokens,
        outputTokens: metrics?.output_tokens,
        cacheCreationInputTokens: metrics?.cache_creation_input_tokens,
        cacheReadInputTokens: metrics?.cache_read_input_tokens,
        cacheCreation5mInputTokens: metrics?.cache_creation_5m_input_tokens,
        cacheCreation1hInputTokens: metrics?.cache_creation_1h_input_tokens,
        cacheTtl: metrics?.cache_ttl ?? null,
        actualResponseModel,
      };
    } catch (err) {
      logger.warn("[FakeStreaming] Failed to parse usage from final body", { error: err });
    }
    return { statusCode: 200, errorMessage: null, usageDetails };
  }

  if (result.errorCode === "client_abort") {
    return {
      statusCode: 499,
      errorMessage: result.errorMessage ?? "client disconnected",
      usageDetails: null,
    };
  }

  return {
    statusCode: 502,
    errorMessage: result.errorMessage ?? "all upstream attempts failed",
    usageDetails: null,
  };
}

function applyNonStreamMutation(session: ProxySession): void {
  const cloned = cloneRequestForInternalNonStreamAttempt({
    format: session.originalFormat,
    pathname: session.requestUrl.pathname,
    search: session.requestUrl.search,
    body: session.request.message,
  });
  if (cloned.body) {
    // Mutate in place so downstream forwarder uses the non-stream body.
    for (const key of Object.keys(session.request.message)) {
      delete (session.request.message as Record<string, unknown>)[key];
    }
    Object.assign(session.request.message, cloned.body);
  }

  if (
    cloned.pathname !== session.requestUrl.pathname ||
    cloned.search !== session.requestUrl.search
  ) {
    const next = new URL(session.requestUrl.toString());
    next.pathname = cloned.pathname;
    next.search = cloned.search;
    session.requestUrl = next;
  }
}

function buildAttemptPerformer(session: ProxySession): AttemptPerformer {
  return async (_attemptIndex, abortSignal) => {
    if (abortSignal.aborted) {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    const response = await ProxyForwarder.send(session);
    try {
      const body = await response.text();
      return {
        status: response.status,
        body,
        providerId: session.provider?.id != null ? String(session.provider.id) : "unknown",
      };
    } finally {
      // ProxyForwarder.send hangs cleanup callbacks on the session that
      // ProxyResponseHandler.dispatch is normally responsible for invoking.
      // Since fake streaming consumes the response body itself, we must run
      // them here or the response timeout timer + agent-pool reservation will
      // leak.
      releaseForwarderResources(session);
    }
  };
}

function releaseForwarderResources(session: ProxySession): void {
  const augmented = session as ProxySession & {
    clearResponseTimeout?: (() => void) | null;
    releaseAgent?: (() => void) | null;
  };
  try {
    augmented.clearResponseTimeout?.();
  } catch {
    /* swallow cleanup errors */
  }
  augmented.clearResponseTimeout = null;
  try {
    augmented.releaseAgent?.();
  } catch {
    /* swallow cleanup errors */
  }
  augmented.releaseAgent = null;
}
