import type { UsageMetrics } from "@/app/v1/_lib/proxy/response-handler";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { isLangfuseEnabled } from "@/lib/langfuse/index";
import { logger } from "@/lib/logger";
import type { CostBreakdown } from "@/lib/utils/cost-calculation";

function buildRequestBodySummary(session: ProxySession): Record<string, unknown> {
  const msg = session.request.message as Record<string, unknown>;
  return {
    model: session.request.model,
    messageCount: session.getMessagesLength(),
    hasSystemPrompt: Array.isArray(msg.system) && msg.system.length > 0,
    toolsCount: Array.isArray(msg.tools) ? msg.tools.length : 0,
    stream: msg.stream === true,
    maxTokens: typeof msg.max_tokens === "number" ? msg.max_tokens : undefined,
    temperature: typeof msg.temperature === "number" ? msg.temperature : undefined,
  };
}

function getStatusCategory(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) return "2xx";
  if (statusCode >= 400 && statusCode < 500) return "4xx";
  if (statusCode >= 500) return "5xx";
  return `${Math.floor(statusCode / 100)}xx`;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

const SUCCESS_REASONS = new Set([
  "request_success",
  "retry_success",
  "initial_selection",
  "session_reuse",
]);

function isSuccessReason(reason: string | undefined): boolean {
  return !!reason && SUCCESS_REASONS.has(reason);
}

const ERROR_REASONS = new Set([
  "system_error",
  "vendor_type_all_timeout",
  "endpoint_pool_exhausted",
]);

function isErrorReason(reason: string | undefined): boolean {
  return !!reason && ERROR_REASONS.has(reason);
}

type ObservationLevel = "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";

export interface TraceContext {
  session: ProxySession;
  responseHeaders: Headers;
  durationMs: number;
  statusCode: number;
  responseText?: string;
  isStreaming: boolean;
  sseEventCount?: number;
  errorMessage?: string;
  usageMetrics?: UsageMetrics | null;
  costUsd?: string;
  costBreakdown?: CostBreakdown;
}

/**
 * Send a trace to Langfuse for a completed proxy request.
 * Fully async and non-blocking. Errors are caught and logged.
 */
export async function traceProxyRequest(ctx: TraceContext): Promise<void> {
  if (!isLangfuseEnabled()) {
    return;
  }

  try {
    const { startObservation, propagateAttributes } = await import("@langfuse/tracing");

    const { session, durationMs, statusCode, isStreaming } = ctx;
    const provider = session.provider;
    const messageContext = session.messageContext;

    // Compute actual request timing from session data
    const requestStartTime = new Date(session.startTime);
    const requestEndTime = new Date(session.startTime + durationMs);

    // Compute timing breakdown from forwardStartTime
    const forwardStartDate = session.forwardStartTime ? new Date(session.forwardStartTime) : null;
    const guardPipelineMs = session.forwardStartTime
      ? session.forwardStartTime - session.startTime
      : null;

    const timingBreakdown = {
      guardPipelineMs,
      upstreamTotalMs:
        guardPipelineMs != null ? Math.max(0, durationMs - guardPipelineMs) : durationMs,
      ttfbFromForwardMs:
        guardPipelineMs != null && session.ttfbMs != null
          ? Math.max(0, session.ttfbMs - guardPipelineMs)
          : null,
      tokenGenerationMs: session.ttfbMs != null ? Math.max(0, durationMs - session.ttfbMs) : null,
      failedAttempts: session.getProviderChain().filter((i) => !isSuccessReason(i.reason)).length,
      providersAttempted: new Set(session.getProviderChain().map((i) => i.id)).size,
    };

    // Compute observation level for root span
    let rootSpanLevel: ObservationLevel = "DEFAULT";
    if (statusCode < 200 || statusCode >= 300) {
      rootSpanLevel = "ERROR";
    } else {
      const failedAttempts = session
        .getProviderChain()
        .filter((i) => !isSuccessReason(i.reason)).length;
      if (failedAttempts >= 1) rootSpanLevel = "WARNING";
    }

    // Actual request body (forwarded to upstream after all preprocessing) - no truncation
    const actualRequestBody = session.forwardedRequestBody
      ? tryParseJsonSafe(session.forwardedRequestBody)
      : session.request.message;

    // Actual response body - no truncation
    const actualResponseBody = ctx.responseText
      ? tryParseJsonSafe(ctx.responseText)
      : isStreaming
        ? { streaming: true, sseEventCount: ctx.sseEventCount }
        : { statusCode };

    // Root span metadata (former input/output summaries moved here)
    const rootSpanMetadata: Record<string, unknown> = {
      endpoint: session.getEndpoint(),
      method: session.method,
      model: session.getCurrentModel(),
      clientFormat: session.originalFormat,
      providerName: provider?.name,
      statusCode,
      durationMs,
      hasUsage: !!ctx.usageMetrics,
      costUsd: ctx.costUsd,
      timingBreakdown,
    };

    // Build tags - include provider name and model
    const tags: string[] = [];
    if (provider?.providerType) tags.push(provider.providerType);
    if (provider?.name) tags.push(provider.name);
    if (session.originalFormat) tags.push(session.originalFormat);
    if (session.getCurrentModel()) tags.push(session.getCurrentModel()!);
    tags.push(getStatusCategory(statusCode));

    // Build trace-level metadata (propagateAttributes requires all values to be strings)
    const traceMetadata: Record<string, string> = {
      keyName: messageContext?.key?.name ?? "",
      endpoint: session.getEndpoint() ?? "",
      method: session.method,
      clientFormat: session.originalFormat,
      userAgent: session.userAgent ?? "",
      requestSequence: String(session.getRequestSequence()),
    };

    // Build generation metadata - all request detail fields, raw headers (no redaction)
    const generationMetadata: Record<string, unknown> = {
      // Provider
      providerId: provider?.id,
      providerName: provider?.name,
      providerType: provider?.providerType,
      providerChain: session.getProviderChain(),
      // Model
      model: session.getCurrentModel(),
      originalModel: session.getOriginalModel(),
      modelRedirected: session.isModelRedirected(),
      // Special settings
      specialSettings: session.getSpecialSettings(),
      // Request context
      endpoint: session.getEndpoint(),
      method: session.method,
      clientFormat: session.originalFormat,
      userAgent: session.userAgent,
      requestSequence: session.getRequestSequence(),
      sessionId: session.sessionId,
      keyName: messageContext?.key?.name,
      // Timing
      durationMs,
      ttfbMs: session.ttfbMs,
      timingBreakdown,
      // Flags
      isStreaming,
      cacheTtlApplied: session.getCacheTtlResolved(),
      context1mApplied: session.getContext1mApplied(),
      // Error
      errorMessage: ctx.errorMessage,
      // Request summary (quick overview)
      requestSummary: buildRequestBodySummary(session),
      // SSE
      sseEventCount: ctx.sseEventCount,
      // Headers (raw, no redaction)
      requestHeaders: headersToRecord(session.headers),
      responseHeaders: headersToRecord(ctx.responseHeaders),
    };

    // Build usage details for Langfuse generation
    const usageDetails: Record<string, number> | undefined = ctx.usageMetrics
      ? {
          ...(ctx.usageMetrics.input_tokens != null
            ? { input: ctx.usageMetrics.input_tokens }
            : {}),
          ...(ctx.usageMetrics.output_tokens != null
            ? { output: ctx.usageMetrics.output_tokens }
            : {}),
          ...(ctx.usageMetrics.cache_read_input_tokens != null
            ? { cache_read_input_tokens: ctx.usageMetrics.cache_read_input_tokens }
            : {}),
          ...(ctx.usageMetrics.cache_creation_input_tokens != null
            ? { cache_creation_input_tokens: ctx.usageMetrics.cache_creation_input_tokens }
            : {}),
        }
      : undefined;

    // Build cost details (prefer breakdown, fallback to total-only)
    const costDetails: Record<string, number> | undefined = ctx.costBreakdown
      ? { ...ctx.costBreakdown }
      : ctx.costUsd && Number.parseFloat(ctx.costUsd) > 0
        ? { total: Number.parseFloat(ctx.costUsd) }
        : undefined;

    // Create the root trace span with actual bodies, level, and metadata
    const rootSpan = startObservation(
      "proxy-request",
      {
        input: actualRequestBody,
        output: actualResponseBody,
        level: rootSpanLevel,
        metadata: rootSpanMetadata,
      },
      {
        startTime: requestStartTime,
      }
    );

    // Propagate trace attributes
    await propagateAttributes(
      {
        userId: messageContext?.user?.name ?? undefined,
        sessionId: session.sessionId ?? undefined,
        tags,
        metadata: traceMetadata,
        traceName: `${session.method} ${session.getEndpoint() ?? "/"}`,
      },
      async () => {
        // 1. Guard pipeline span (if forwardStartTime was recorded)
        if (forwardStartDate) {
          const guardSpan = rootSpan.startObservation(
            "guard-pipeline",
            {
              output: { durationMs: guardPipelineMs, passed: true },
            },
            { startTime: requestStartTime } as Record<string, unknown>
          );
          guardSpan.end(forwardStartDate);
        }

        // 2. Provider attempt events (one per failed chain item)
        for (const item of session.getProviderChain()) {
          if (!isSuccessReason(item.reason)) {
            const eventObs = rootSpan.startObservation(
              "provider-attempt",
              {
                level: isErrorReason(item.reason) ? "ERROR" : "WARNING",
                input: {
                  providerId: item.id,
                  providerName: item.name,
                  attempt: item.attemptNumber,
                },
                output: {
                  reason: item.reason,
                  errorMessage: item.errorMessage,
                  statusCode: item.statusCode,
                },
                metadata: { ...item },
              },
              {
                asType: "event",
                startTime: new Date(item.timestamp ?? session.startTime),
              } as { asType: "event" }
            );
            eventObs.end();
          }
        }

        // 3. LLM generation (startTime = forwardStartTime when available)
        const generationStartTime = forwardStartDate ?? requestStartTime;

        // Generation input/output = raw payload, no truncation
        const generationInput = actualRequestBody;
        const generationOutput = ctx.responseText
          ? tryParseJsonSafe(ctx.responseText)
          : isStreaming
            ? { streaming: true, sseEventCount: ctx.sseEventCount }
            : { statusCode };

        // Create the LLM generation observation
        const generation = rootSpan.startObservation(
          "llm-call",
          {
            model: session.getCurrentModel() ?? undefined,
            input: generationInput,
            output: generationOutput,
            ...(usageDetails && Object.keys(usageDetails).length > 0 ? { usageDetails } : {}),
            ...(costDetails ? { costDetails } : {}),
            metadata: generationMetadata,
          },
          // SDK runtime supports startTime on child observations but types don't expose it
          { asType: "generation", startTime: generationStartTime } as { asType: "generation" }
        );

        // Set TTFB as completionStartTime
        if (session.ttfbMs != null) {
          generation.update({
            completionStartTime: new Date(session.startTime + session.ttfbMs),
          });
        }

        generation.end(requestEndTime);
      }
    );

    // Explicitly set trace-level input/output (propagateAttributes does not support these)
    rootSpan.updateTrace({
      input: actualRequestBody,
      output: actualResponseBody,
    });

    rootSpan.end(requestEndTime);
  } catch (error) {
    logger.warn("[Langfuse] Failed to trace proxy request", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function tryParseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
