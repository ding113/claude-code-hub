import type { UsageMetrics } from "@/app/v1/_lib/proxy/response-handler";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { logger } from "@/lib/logger";
import type { CostBreakdown } from "@/lib/utils/cost-calculation";

const LANGFUSE_RESPONSE_TEXT_MAX_CHARS = 1024 * 1024;
const LANGFUSE_RESPONSE_TEXT_EDGE_CHARS = 128 * 1024;
const LANGFUSE_TRUNCATED_MARKER = "\n\n[langfuse_response_truncated]\n\n";

export interface EmitProxyLangfuseTraceData {
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

function truncateResponseTextForLangfuse(text: string): string {
  if (text.length <= LANGFUSE_RESPONSE_TEXT_MAX_CHARS) {
    return text;
  }

  return `${text.slice(0, LANGFUSE_RESPONSE_TEXT_EDGE_CHARS)}${LANGFUSE_TRUNCATED_MARKER}${text.slice(
    -LANGFUSE_RESPONSE_TEXT_EDGE_CHARS
  )}`;
}

function buildRequestMessagePreview(message: Record<string, unknown>): Record<string, unknown> {
  return {
    truncatedForLangfuse: true,
    model: typeof message.model === "string" ? message.model : undefined,
    stream: typeof message.stream === "boolean" ? message.stream : undefined,
    max_tokens: typeof message.max_tokens === "number" ? message.max_tokens : undefined,
    temperature: typeof message.temperature === "number" ? message.temperature : undefined,
    messageCount: Array.isArray(message.messages) ? message.messages.length : undefined,
    contentsCount: Array.isArray(message.contents) ? message.contents.length : undefined,
    toolsCount: Array.isArray(message.tools) ? message.tools.length : undefined,
    hasSystemPrompt:
      (Array.isArray(message.system) && message.system.length > 0) ||
      (typeof message.system === "string" && message.system.length > 0),
  };
}

function buildLangfuseSessionSnapshot(session: ProxySession): ProxySession {
  const providerChain = session.getProviderChain().map((item) => ({ ...item }));
  const specialSettings = session.getSpecialSettings();
  const cacheTtlResolved = session.getCacheTtlResolved();
  const context1mApplied = session.getContext1mApplied();
  const currentModel = session.getCurrentModel();
  const originalModel = session.getOriginalModel();
  const modelRedirected = session.isModelRedirected();
  const endpoint = session.getEndpoint();
  const requestSequence = session.getRequestSequence();
  const messagesLength = session.getMessagesLength();
  const forwardedRequestBody =
    typeof session.forwardedRequestBody === "string"
      ? truncateResponseTextForLangfuse(session.forwardedRequestBody)
      : null;
  const requestMessage = buildRequestMessagePreview(session.request.message);

  return {
    startTime: session.startTime,
    method: session.method,
    headers: new Headers(session.headers),
    request: {
      message: requestMessage,
      log: truncateResponseTextForLangfuse(session.request.log ?? ""),
      note: session.request.note,
      model: session.request.model,
      imageRequestMetadata: null,
    },
    userAgent: session.userAgent,
    provider: session.provider,
    messageContext: session.messageContext,
    ttfbMs: session.ttfbMs,
    forwardStartTime: session.forwardStartTime,
    forwardedRequestBody,
    sessionId: session.sessionId,
    originalFormat: session.originalFormat,
    getMessagesLength: () => messagesLength,
    getEndpoint: () => endpoint,
    getCurrentModel: () => currentModel,
    getProviderChain: () => providerChain,
    getRequestSequence: () => requestSequence,
    getOriginalModel: () => originalModel,
    isModelRedirected: () => modelRedirected,
    getSpecialSettings: () => specialSettings,
    getCacheTtlResolved: () => cacheTtlResolved,
    getContext1mApplied: () => context1mApplied,
  } as unknown as ProxySession;
}

/**
 * 异步发送代理请求的 Langfuse trace。
 *
 * 这里保持 fire-and-forget，避免观测系统故障影响代理响应。
 */
export function emitProxyLangfuseTrace(
  session: ProxySession,
  data: EmitProxyLangfuseTraceData
): void {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return;

  let responseText: string;
  let sessionSnapshot: ProxySession;
  try {
    // 必须在异步 import 之前截断，避免动态加载/SDK 发送期间闭包继续强引用完整大响应。
    responseText = truncateResponseTextForLangfuse(data.responseText);
    sessionSnapshot = buildLangfuseSessionSnapshot(session);
  } catch (err) {
    logger.warn("[Langfuse] Proxy trace snapshot failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const {
    responseHeaders,
    durationMs,
    statusCode,
    isStreaming,
    usageMetrics,
    costUsd,
    costBreakdown,
    sseEventCount,
    errorMessage,
  } = data;

  void import("@/lib/langfuse/trace-proxy-request")
    .then(({ traceProxyRequest }) => {
      void traceProxyRequest({
        session: sessionSnapshot,
        responseHeaders,
        durationMs,
        statusCode,
        isStreaming,
        responseText,
        usageMetrics,
        costUsd,
        costBreakdown,
        sseEventCount,
        errorMessage,
      });
    })
    .catch((err) => {
      logger.warn("[Langfuse] Proxy trace failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
}
