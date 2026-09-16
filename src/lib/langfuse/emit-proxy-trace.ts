import type { UsageMetrics } from "@/app/v1/_lib/proxy/response-handler";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { decompressPayload } from "@/lib/compression/payload-codec";
import { finalizeStreamOutputForClient } from "@/lib/langfuse/stream-final-output";
import {
  createFinalOutputUnavailable,
  type StreamFinalOutput,
} from "@/lib/langfuse/stream-final-output-core";
import type { LangfuseTraceBodySource } from "@/lib/langfuse/trace-body-spool";
import type { TraceContext } from "@/lib/langfuse/trace-proxy-request";
import { logger } from "@/lib/logger";
import type { CostBreakdown } from "@/lib/utils/cost-calculation";

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
  /** 流式完整正文来源；所有权转移给本函数，由它负责释放。 */
  responseBodySpool?: LangfuseTraceBodySource | null;
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
  // 这里拿到的是不透明句柄（通常已是压缩信封），解码推迟到异步阶段。
  const forwardedRequestBody =
    typeof session.forwardedRequestBody === "string" ? session.forwardedRequestBody : null;
  const requestMessage = buildRequestMessagePreview(session.request.message);
  const clientIp = session.clientIp;
  const originalHeaders =
    typeof session.getOriginalHeaders === "function"
      ? new Headers(session.getOriginalHeaders())
      : new Headers(session.headers);

  return {
    startTime: session.startTime,
    method: session.method,
    headers: new Headers(session.headers),
    request: {
      message: requestMessage,
      log: session.request.log ?? "",
      note: session.request.note,
      model: session.request.model,
      imageRequestMetadata: null,
    },
    userAgent: session.userAgent,
    provider: session.provider,
    messageContext: session.messageContext,
    ttftMs: session.ttftMs,
    firstByteMs: session.firstByteMs,
    forwardStartTime: session.forwardStartTime,
    forwardedRequestBody,
    sessionId: session.sessionId,
    clientIp,
    originalFormat: session.originalFormat,
    getOriginalHeaders: () => new Headers(originalHeaders),
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

async function runLangfuseTrace(
  sessionSnapshot: ProxySession,
  data: EmitProxyLangfuseTraceData,
  spool: LangfuseTraceBodySource | null
): Promise<void> {
  // 先让出调用栈：materialize / finalize / 发送都不应该占用代理的终态路径。
  await new Promise<void>((resolve) => setImmediate(resolve));

  try {
    const {
      responseHeaders,
      responseText,
      durationMs,
      statusCode,
      isStreaming,
      usageMetrics,
      costUsd,
      costBreakdown,
      sseEventCount,
      errorMessage,
    } = data;

    const forwardedHandle = sessionSnapshot.forwardedRequestBody;
    (sessionSnapshot as { forwardedRequestBody: string | null }).forwardedRequestBody =
      typeof forwardedHandle === "string" ? await decompressPayload(forwardedHandle) : null;

    let streamText = responseText;
    if (isStreaming && spool) {
      const fullText = await spool.materialize();
      if (fullText !== null) streamText = fullText;
    }

    let finalResponseOutput: StreamFinalOutput | undefined;
    if (isStreaming && streamText.length > 0) {
      try {
        finalResponseOutput = finalizeStreamOutputForClient(
          streamText,
          sessionSnapshot.originalFormat,
          true
        );
      } catch (error) {
        finalResponseOutput = createFinalOutputUnavailable("stream_error");
        logger.warn("[Langfuse] Stream finalization failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const traceContext: TraceContext = {
      session: sessionSnapshot,
      responseHeaders,
      durationMs,
      statusCode,
      isStreaming,
      ...(isStreaming ? {} : { responseText }),
      ...(finalResponseOutput !== undefined ? { finalResponseOutput } : {}),
      usageMetrics,
      costUsd,
      costBreakdown,
      sseEventCount,
      errorMessage,
    };

    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");
    await traceProxyRequest(traceContext);
  } catch (err) {
    logger.warn("[Langfuse] Proxy trace failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await spool?.dispose();
  }
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
  const spool = data.responseBodySpool ?? null;

  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    void spool?.dispose();
    return;
  }

  let sessionSnapshot: ProxySession;
  try {
    sessionSnapshot = buildLangfuseSessionSnapshot(session);
  } catch (err) {
    logger.warn("[Langfuse] Proxy trace snapshot failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    void spool?.dispose();
    return;
  }

  void runLangfuseTrace(sessionSnapshot, data, spool);
}
