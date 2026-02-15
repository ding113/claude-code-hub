import type { UsageMetrics } from "@/app/v1/_lib/proxy/response-handler";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { isLangfuseEnabled } from "@/lib/langfuse/index";
import { logger } from "@/lib/logger";

// Auth-sensitive header names to redact
const REDACTED_HEADERS = new Set([
  "x-api-key",
  "authorization",
  "x-goog-api-key",
  "anthropic-api-key",
  "cookie",
  "set-cookie",
]);

function sanitizeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? "[REDACTED]" : value;
  });
  return result;
}

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

const LANGFUSE_MAX_IO_SIZE = Number(process.env.LANGFUSE_MAX_IO_SIZE) || 100_000;

/**
 * Truncate data for Langfuse to avoid excessive payload sizes.
 */
function truncateForLangfuse(data: unknown, maxChars: number = LANGFUSE_MAX_IO_SIZE): unknown {
  if (typeof data === "string") {
    return data.length > maxChars ? `${data.substring(0, maxChars)}...[truncated]` : data;
  }
  if (data != null && typeof data === "object") {
    const str = JSON.stringify(data);
    if (str.length > maxChars) {
      return {
        _truncated: true,
        _length: str.length,
        _preview: str.substring(0, Math.min(maxChars, 2000)),
      };
    }
    return data;
  }
  return data;
}

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

    // Build generation metadata - all request detail fields
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
      // Headers (sanitized)
      requestHeaders: sanitizeHeaders(session.headers),
      responseHeaders: sanitizeHeaders(ctx.responseHeaders),
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

    // Build cost details
    const costDetails: Record<string, number> | undefined =
      ctx.costUsd && Number.parseFloat(ctx.costUsd) > 0
        ? { total: Number.parseFloat(ctx.costUsd) }
        : undefined;

    // Create the root trace span
    const rootSpan = startObservation(
      "proxy-request",
      {
        input: {
          endpoint: session.getEndpoint(),
          method: session.method,
          model: session.getCurrentModel(),
          clientFormat: session.originalFormat,
          providerName: provider?.name,
        },
        output: {
          statusCode,
          durationMs,
          model: session.getCurrentModel(),
          hasUsage: !!ctx.usageMetrics,
          costUsd: ctx.costUsd,
        },
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
        // Generation input = actual request payload
        const generationInput = truncateForLangfuse(session.request.message);

        // Generation output = actual response body
        const generationOutput = ctx.responseText
          ? truncateForLangfuse(tryParseJsonSafe(ctx.responseText))
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
          { asType: "generation", startTime: requestStartTime } as { asType: "generation" }
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
      input: {
        endpoint: session.getEndpoint(),
        method: session.method,
        model: session.getCurrentModel(),
        clientFormat: session.originalFormat,
        providerName: provider?.name,
      },
      output: {
        statusCode,
        durationMs,
        model: session.getCurrentModel(),
        hasUsage: !!ctx.usageMetrics,
        costUsd: ctx.costUsd,
      },
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
