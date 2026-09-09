import { sanitizeHeaders } from "@/app/v1/_lib/proxy/errors";
import type { UsageMetrics } from "@/app/v1/_lib/proxy/response-handler";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { redactHeaders } from "@/lib/api/v1/_shared/redaction";
import { isLangfuseEnabled } from "@/lib/langfuse/index";
import {
  createFinalOutputUnavailable,
  type StreamFinalOutput,
} from "@/lib/langfuse/stream-final-output-core";
import { logger } from "@/lib/logger";
import type { CostBreakdown } from "@/lib/utils/cost-calculation";

const LANGFUSE_JSON_PARSE_MAX_CHARS = 1024 * 1024;
const LANGFUSE_TEXT_PREVIEW_EDGE_CHARS = 128 * 1024;
const LANGFUSE_PROPAGATED_STRING_MAX_CHARS = 200;

function clampLangfusePropagatedString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length <= LANGFUSE_PROPAGATED_STRING_MAX_CHARS
    ? value
    : value.slice(0, LANGFUSE_PROPAGATED_STRING_MAX_CHARS);
}

function clampLangfusePropagatedMetadata(metadata: Record<string, string>): Record<string, string> {
  const clamped: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const next = clampLangfusePropagatedString(value);
    if (next !== undefined) {
      clamped[key] = next;
    }
  }
  return clamped;
}

function clampLangfuseTags(tags: string[]): string[] {
  return tags
    .map((tag) => clampLangfusePropagatedString(tag))
    .filter((tag): tag is string => tag !== undefined);
}

/** Keep the segment after the last `/` so provider prefixes stay out of the name. */
function langfuseModelShortName(model: string | undefined): string {
  if (!model) return "unknown";
  const separator = model.lastIndexOf("/");
  const shortName = separator >= 0 ? model.slice(separator + 1) : model;
  return shortName || "unknown";
}

function buildLangfuseDisplayName(
  username: string | undefined,
  model: string | undefined
): string | undefined {
  const shortModel = langfuseModelShortName(model);
  return clampLangfusePropagatedString(username ? `${username}:${shortModel}` : shortModel);
}

function buildRequestBodySummary(session: ProxySession): Record<string, unknown> {
  const msg = session.request.message as Record<string, unknown>;
  const hasSystemPrompt =
    typeof msg.hasSystemPrompt === "boolean"
      ? msg.hasSystemPrompt
      : Array.isArray(msg.system) && msg.system.length > 0;
  const toolsCount =
    typeof msg.toolsCount === "number"
      ? msg.toolsCount
      : Array.isArray(msg.tools)
        ? msg.tools.length
        : 0;

  return {
    model: session.request.model,
    messageCount: session.getMessagesLength(),
    hasSystemPrompt,
    toolsCount,
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

function sanitizeProviderChainValue(value: unknown, key?: string): unknown {
  if (key === "headers" && typeof value === "string") {
    return sanitizeHeaders(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProviderChainValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeProviderChainValue(entryValue, entryKey),
      ])
    );
  }
  return value;
}

function redactLangfuseHeaders(headers: Headers): Record<string, string> {
  const externalHeaders = new Headers();
  headers.forEach((value, key) => {
    if (!key.toLowerCase().startsWith("x-cch-")) {
      externalHeaders.append(key, value);
    }
  });
  return redactHeaders(externalHeaders);
}

function headersToSanitizedRecord(headers: Headers): Record<string, string> {
  const sanitizedText = sanitizeHeaders(headers);
  if (!sanitizedText || sanitizedText === "(empty)") {
    return {};
  }

  const record: Record<string, string> = {};
  for (const line of sanitizedText.split(/\r?\n/).filter(Boolean)) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const name = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (!name) continue;
    record[name] = record[name] ? `${record[name]}\n${value}` : value;
  }
  return record;
}

const SUCCESS_REASONS = new Set([
  "request_success",
  "retry_success",
  "initial_selection",
  "session_reuse",
  "hedge_winner",
]);

function isSuccessReason(reason: string | undefined): boolean {
  return !!reason && SUCCESS_REASONS.has(reason);
}

const ERROR_REASONS = new Set([
  "system_error",
  "vendor_type_all_timeout",
  "endpoint_pool_exhausted",
  "client_abort",
  "client_abort_no_first_byte",
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
  finalResponseOutput?: StreamFinalOutput;
  isStreaming: boolean;
  sseEventCount?: number;
  errorMessage?: string;
  usageMetrics?: UsageMetrics | null;
  costUsd?: string;
  costBreakdown?: CostBreakdown;
}

function hasRequestInput(ctx: TraceContext): boolean {
  if (
    typeof ctx.session.forwardedRequestBody === "string" &&
    ctx.session.forwardedRequestBody.trim().length > 0
  ) {
    return true;
  }

  return Object.keys(ctx.session.request.message ?? {}).length > 0;
}

function isResponseMissing(ctx: TraceContext): boolean {
  if (ctx.responseText) return false;
  if (ctx.errorMessage) return true;
  if (!hasRequestInput(ctx)) return false;
  if (ctx.isStreaming) return ctx.sseEventCount === 0;

  return true;
}

type ResponseOutputMetadata = {
  id?: unknown;
  status?: unknown;
  model?: unknown;
};

type ResponseCapture = {
  output: unknown;
  metadata?: ResponseOutputMetadata;
  usageDetails?: {
    input_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
    total_tokens?: number;
  };
};

const RESPONSE_TOOL_CALL_EXCLUDED_FIELDS: Record<string, true> = {
  id: true,
  status: true,
  internal_chat_message_metadata_passthrough: true,
  metadata: true,
};

function sanitizeResponseOutputItem(value: unknown, isInsideToolCall = false): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;

  const item = value as Record<string, unknown>;
  const isToolCall =
    isInsideToolCall ||
    (typeof item.type === "string" && (item.type.endsWith("_call") || item.type === "tool_calls"));

  return Object.fromEntries(
    Object.entries(item)
      .filter(([key]) => !isToolCall || RESPONSE_TOOL_CALL_EXCLUDED_FIELDS[key] === undefined)
      .map(([key, child]) => [
        key,
        Array.isArray(child)
          ? child.map((entry) => sanitizeResponseOutputItem(entry, isToolCall))
          : sanitizeResponseOutputItem(child, isToolCall),
      ])
  );
}

function buildResponseCapture(ctx: TraceContext): ResponseCapture {
  const responseValue =
    ctx.finalResponseOutput?.kind === "final"
      ? ctx.finalResponseOutput.value
      : ctx.isStreaming || !ctx.responseText
        ? undefined
        : tryParseJsonSafe(ctx.responseText);

  if (
    ctx.session.originalFormat === "response" &&
    typeof responseValue === "object" &&
    responseValue !== null &&
    !Array.isArray(responseValue)
  ) {
    const response = responseValue as Record<string, unknown>;
    const usage =
      typeof response.usage === "object" &&
      response.usage !== null &&
      !Array.isArray(response.usage)
        ? (response.usage as Record<string, unknown>)
        : undefined;
    const inputTokenDetails =
      typeof usage?.input_tokens_details === "object" &&
      usage.input_tokens_details !== null &&
      !Array.isArray(usage.input_tokens_details)
        ? (usage.input_tokens_details as Record<string, unknown>)
        : undefined;
    const outputTokenDetails =
      typeof usage?.output_tokens_details === "object" &&
      usage.output_tokens_details !== null &&
      !Array.isArray(usage.output_tokens_details)
        ? (usage.output_tokens_details as Record<string, unknown>)
        : undefined;
    const usageDetails: ResponseCapture["usageDetails"] = usage
      ? {
          ...(typeof usage.input_tokens === "number" ? { input_tokens: usage.input_tokens } : {}),
          ...(typeof inputTokenDetails?.cached_tokens === "number"
            ? { input_tokens_details: { cached_tokens: inputTokenDetails.cached_tokens } }
            : {}),
          ...(typeof usage.output_tokens === "number"
            ? { output_tokens: usage.output_tokens }
            : {}),
          ...(typeof outputTokenDetails?.reasoning_tokens === "number"
            ? { output_tokens_details: { reasoning_tokens: outputTokenDetails.reasoning_tokens } }
            : {}),
          ...(typeof usage.total_tokens === "number" ? { total_tokens: usage.total_tokens } : {}),
        }
      : undefined;
    const metadata: ResponseOutputMetadata = {
      ...(response.id !== undefined ? { id: response.id } : {}),
      ...(response.status !== undefined ? { status: response.status } : {}),
      ...(response.model !== undefined ? { model: response.model } : {}),
    };

    return {
      output: Array.isArray(response.output)
        ? response.output.map((item) => sanitizeResponseOutputItem(item))
        : undefined,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      ...(usageDetails && Object.keys(usageDetails).length > 0 ? { usageDetails } : {}),
    };
  }

  if (ctx.finalResponseOutput?.kind === "final") {
    return { output: ctx.finalResponseOutput.value };
  }
  if (ctx.finalResponseOutput !== undefined) {
    return { output: ctx.finalResponseOutput };
  }

  if (ctx.isStreaming) {
    return {
      output: createFinalOutputUnavailable("no_terminal_event", {
        eventCount: ctx.sseEventCount ?? 0,
        status: ctx.statusCode,
      }),
    };
  }

  if (ctx.responseText) {
    return { output: tryParseJsonSafe(ctx.responseText) };
  }

  const responseMissing = isResponseMissing(ctx);
  const output: Record<string, unknown> = ctx.isStreaming
    ? { streaming: true, sseEventCount: ctx.sseEventCount }
    : { statusCode: ctx.statusCode };

  if (responseMissing) {
    output.responseMissing = true;
  }

  if (ctx.errorMessage) {
    if (ctx.isStreaming) {
      output.statusCode = ctx.statusCode;
    }
    output.errorMessage = ctx.errorMessage;
  }

  return { output };
}

function buildLargeTextPreview(text: string): Record<string, unknown> {
  return {
    truncated: true,
    totalChars: text.length,
    head: text.slice(0, LANGFUSE_TEXT_PREVIEW_EDGE_CHARS),
    tail: text.slice(-LANGFUSE_TEXT_PREVIEW_EDGE_CHARS),
  };
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
      ttftFromForwardMs:
        guardPipelineMs != null && session.ttftMs != null
          ? Math.max(0, session.ttftMs - guardPipelineMs)
          : null,
      tokenGenerationMs: session.ttftMs != null ? Math.max(0, durationMs - session.ttftMs) : null,
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
    // Actual request and response bodies are not truncated.
    const actualRequestBody = session.forwardedRequestBody
      ? tryParseJsonSafe(session.forwardedRequestBody)
      : session.request.message;
    const actualResponse = buildResponseCapture(ctx);
    const actualResponseBody = actualResponse.output;
    const responseOutputMetadata = actualResponse.metadata;
    const responseUsageDetails = actualResponse.usageDetails;
    const responseMissing = isResponseMissing(ctx);

    // Root span metadata (former input/output summaries moved here)
    const rootSpanMetadata: Record<string, unknown> = {
      endpoint: session.getEndpoint(),
      method: session.method,
      model: session.getCurrentModel(),
      clientFormat: session.originalFormat,
      providerName: provider?.name,
      userName: messageContext?.user?.name ?? session.userName ?? null,
      keyName: messageContext?.key?.name ?? null,
      clientIp: session.clientIp ?? null,
      statusCode,
      durationMs,
      errorMessage: ctx.errorMessage,
      responseMissing,
      hasUsage: !!ctx.usageMetrics,
      costUsd: ctx.costUsd,
      timingBreakdown,
    };

    // Build tags - include provider name and model
    const tags = clampLangfuseTags([
      ...(provider?.providerType ? [provider.providerType] : []),
      ...(provider?.name ? [provider.name] : []),
      ...(session.originalFormat ? [session.originalFormat] : []),
      ...(session.getCurrentModel() ? [session.getCurrentModel()!] : []),
      getStatusCategory(statusCode),
    ]);

    // Build trace-level metadata (propagateAttributes requires all values to be strings ≤200)
    const traceMetadata = clampLangfusePropagatedMetadata({
      userName: messageContext?.user?.name ?? session.userName ?? "",
      keyName: messageContext?.key?.name ?? "",
      clientIp: session.clientIp ?? "",
      endpoint: session.getEndpoint() ?? "",
      method: session.method,
      clientFormat: session.originalFormat,
      userAgent: session.userAgent ?? "",
      requestSequence: String(session.getRequestSequence()),
    });

    const requestHeaders = redactLangfuseHeaders(session.headers);
    const responseHeaders = redactLangfuseHeaders(ctx.responseHeaders);

    const generationMetadata: Record<string, unknown> = {
      // Provider
      providerId: provider?.id,
      providerName: provider?.name,
      providerType: provider?.providerType,
      providerChain: sanitizeProviderChainValue(session.getProviderChain()),
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
      userName: messageContext?.user?.name ?? session.userName ?? null,
      keyName: messageContext?.key?.name ?? null,
      clientIp: session.clientIp ?? null,
      // Timing
      durationMs,
      ttftMs: session.ttftMs,
      firstByteMs: session.firstByteMs,
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
      requestHeaders,
      responseHeaders,
      client_metadata: headersToSanitizedRecord(
        typeof session.getOriginalHeaders === "function"
          ? session.getOriginalHeaders()
          : session.headers
      ),
      ...(responseOutputMetadata !== undefined ? { response: responseOutputMetadata } : {}),
    };

    // Responses API reports native Langfuse token dimensions from its own output.
    const usageDetails: Record<string, number> | undefined =
      responseUsageDetails !== undefined
        ? (responseUsageDetails as unknown as Record<string, number>)
        : ctx.usageMetrics
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

    const username = messageContext?.user?.name ?? session.userName ?? undefined;
    const displayName =
      buildLangfuseDisplayName(username, session.getCurrentModel() ?? undefined) ?? "unknown";

    // Official v5: wrap ALL observations in propagateAttributes so userId/sessionId/tags
    // land on the root span too. Child startObservation on the wrapper drops startTime;
    // use the module-level API with parentSpanContext instead.
    await propagateAttributes(
      {
        userId: clampLangfusePropagatedString(username),
        sessionId: clampLangfusePropagatedString(session.sessionId ?? undefined),
        tags,
        metadata: traceMetadata,
        traceName: displayName,
      },
      async () => {
        const rootSpan = startObservation(
          displayName,
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

        const parentSpanContext = rootSpan.otelSpan.spanContext();

        if (forwardStartDate) {
          const guardSpan = startObservation(
            "guard-pipeline",
            {
              output: { durationMs: guardPipelineMs, passed: true },
            },
            { startTime: requestStartTime, parentSpanContext }
          );
          guardSpan.end(forwardStartDate);
        }

        for (const rawItem of session.getProviderChain()) {
          const item = sanitizeProviderChainValue(rawItem) as typeof rawItem;
          if (item.reason === "hedge_triggered") {
            const hedgeObs = startObservation(
              "hedge-trigger",
              {
                level: "WARNING" as ObservationLevel,
                input: {
                  providerId: item.id,
                  providerName: item.name,
                  attempt: item.attemptNumber,
                },
                output: {
                  reason: item.reason,
                  circuitState: item.circuitState,
                },
                metadata: { ...item },
              },
              {
                asType: "event",
                startTime: new Date(item.timestamp ?? session.startTime),
                parentSpanContext,
              }
            );
            hedgeObs.end();
            continue;
          }

          if (!isSuccessReason(item.reason)) {
            const eventObs = startObservation(
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
                parentSpanContext,
              }
            );
            eventObs.end();
          }
        }

        const generationStartTime = forwardStartDate ?? requestStartTime;
        const generation = startObservation(
          "llm-call",
          {
            model: session.getCurrentModel() ?? undefined,
            input: actualRequestBody,
            output: actualResponseBody,
            ...(usageDetails && Object.keys(usageDetails).length > 0 ? { usageDetails } : {}),
            ...(costDetails ? { costDetails } : {}),
            metadata: generationMetadata,
          },
          {
            asType: "generation",
            startTime: generationStartTime,
            parentSpanContext,
          }
        );

        if (session.ttftMs != null) {
          generation.update({
            completionStartTime: new Date(session.startTime + session.ttftMs),
          });
        }

        generation.end(requestEndTime);
        rootSpan.end(requestEndTime);
      }
    );
  } catch (error) {
    logger.warn("[Langfuse] Failed to trace proxy request", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function tryParseJsonSafe(text: string): unknown {
  if (text.length > LANGFUSE_JSON_PARSE_MAX_CHARS) {
    return buildLargeTextPreview(text);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
