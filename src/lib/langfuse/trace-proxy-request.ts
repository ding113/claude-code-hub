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

export interface TraceContext {
  session: ProxySession;
  response: Response;
  durationMs: number;
  statusCode: number;
  responseText?: string;
  isStreaming: boolean;
  sseEventCount?: number;
  errorMessage?: string;
  usageMetrics?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  } | null;
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

    const { session, response, durationMs, statusCode, isStreaming } = ctx;
    const provider = session.provider;
    const messageContext = session.messageContext;

    // Build tags
    const tags: string[] = [];
    if (provider?.providerType) tags.push(provider.providerType);
    if (session.originalFormat) tags.push(session.originalFormat);
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

    // Build generation metadata
    const generationMetadata: Record<string, unknown> = {
      providerId: provider?.id,
      providerName: provider?.name,
      providerType: provider?.providerType,
      providerChain: session.getProviderChain(),
      specialSettings: session.getSpecialSettings(),
      modelRedirected: session.isModelRedirected(),
      originalModel: session.isModelRedirected() ? session.getOriginalModel() : undefined,
      isStreaming,
      statusCode,
      durationMs,
      ttfbMs: session.ttfbMs,
      cacheTtlApplied: session.getCacheTtlResolved(),
      context1mApplied: session.getContext1mApplied(),
      errorMessage: ctx.errorMessage,
      requestHeaders: sanitizeHeaders(session.headers),
      responseHeaders: sanitizeHeaders(response.headers),
      requestBodySummary: buildRequestBodySummary(session),
    };

    // Add response body summary
    if (isStreaming) {
      generationMetadata.sseEventCount = ctx.sseEventCount;
    } else if (ctx.responseText) {
      generationMetadata.responseBodySummary =
        ctx.responseText.length > 2000
          ? `${ctx.responseText.substring(0, 2000)}...[truncated]`
          : ctx.responseText;
    }

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
            ? { cacheRead: ctx.usageMetrics.cache_read_input_tokens }
            : {}),
          ...(ctx.usageMetrics.cache_creation_input_tokens != null
            ? { cacheCreation: ctx.usageMetrics.cache_creation_input_tokens }
            : {}),
        }
      : undefined;

    // Build cost details
    const costDetails: Record<string, number> | undefined =
      ctx.costUsd && Number.parseFloat(ctx.costUsd) > 0
        ? { totalUsd: Number.parseFloat(ctx.costUsd) }
        : undefined;

    // Create the root trace span
    const rootSpan = startObservation("proxy-request", {
      input: traceMetadata,
      output: {
        statusCode,
        durationMs,
        model: session.getCurrentModel(),
        hasUsage: !!ctx.usageMetrics,
      },
    });

    // Propagate trace attributes
    await propagateAttributes(
      {
        userId: messageContext?.user?.id ? String(messageContext.user.id) : undefined,
        sessionId: session.sessionId ?? undefined,
        tags,
        metadata: traceMetadata,
        traceName: `${session.method} ${session.getEndpoint() ?? "/"}`,
      },
      async () => {
        // Create the LLM generation observation
        const generation = rootSpan.startObservation(
          "llm-call",
          {
            model: session.getCurrentModel() ?? undefined,
            input: buildRequestBodySummary(session),
            output: isStreaming
              ? { streaming: true, sseEventCount: ctx.sseEventCount }
              : ctx.responseText
                ? tryParseJsonSafe(ctx.responseText)
                : { statusCode },
            ...(usageDetails && Object.keys(usageDetails).length > 0 ? { usageDetails } : {}),
            ...(costDetails ? { costDetails } : {}),
            metadata: generationMetadata,
          },
          { asType: "generation" }
        );

        // Set TTFB as completionStartTime
        if (session.ttfbMs != null) {
          generation.update({
            completionStartTime: new Date(session.startTime + session.ttfbMs),
          });
        }

        generation.end();
      }
    );

    rootSpan.end();
  } catch (error) {
    logger.warn("[Langfuse] Failed to trace proxy request", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function tryParseJsonSafe(text: string): unknown {
  try {
    const parsed = JSON.parse(text);
    // Truncate large outputs to avoid excessive data
    const str = JSON.stringify(parsed);
    if (str.length > 4000) {
      return { _truncated: true, _length: str.length, _preview: str.substring(0, 2000) };
    }
    return parsed;
  } catch {
    return text.length > 2000 ? `${text.substring(0, 2000)}...[truncated]` : text;
  }
}
