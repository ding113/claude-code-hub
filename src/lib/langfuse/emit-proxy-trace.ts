import type { UsageMetrics } from "@/app/v1/_lib/proxy/response-handler";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
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
      logger.warn("[Langfuse] Proxy trace failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
}
