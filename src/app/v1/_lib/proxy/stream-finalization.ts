import type { ProxySession } from "./session";

/**
 * 流式响应（SSE）在“收到响应头”时无法确定成功与否：
 * - 上游可能返回 HTTP 200，但 body 是错误 JSON（假 200）
 * - 只有在 SSE 结束后才能做最终判定
 *
 * 该结构用于 Forwarder → ResponseHandler 之间传递“延迟结算”的必要信息：
 * - Forwarder：拿到 Response 后尽快开始向客户端透传（降低延迟）；但不要立刻记为 success/绑定 session。
 * - ResponseHandler：在流正常结束后，基于最终响应体做一次补充检查，然后再更新熔断/endpoint/会话绑定。
 *
 * 说明：
 * - 这里选择“把元信息挂到 session 上”而不是改动大量类型/函数签名，避免改动面过大；
 * - 元信息是一次性的：消费后会被清空，避免跨请求污染。
 */
export type DeferredStreamingFinalization = {
  providerId: number;
  providerName: string;
  providerPriority: number;
  attemptNumber: number;
  totalProvidersAttempted: number;
  isFirstAttempt: boolean;
  isFailoverSuccess: boolean;
  endpointId: number | null;
  endpointUrl: string;
  upstreamStatusCode: number;
};

type SessionWithDeferred = ProxySession & {
  deferredStreamingFinalization?: DeferredStreamingFinalization;
};

export function setDeferredStreamingFinalization(
  session: ProxySession,
  meta: DeferredStreamingFinalization
): void {
  // Forwarder 在识别到 SSE 时调用：标记该请求需要在流结束后“二次结算”。
  (session as SessionWithDeferred).deferredStreamingFinalization = meta;
}

export function consumeDeferredStreamingFinalization(
  session: ProxySession
): DeferredStreamingFinalization | null {
  const s = session as SessionWithDeferred;
  const meta = s.deferredStreamingFinalization ?? null;
  if (meta) {
    // 只允许消费一次：避免重复结算（例如多个后台统计任务并行时）。
    s.deferredStreamingFinalization = undefined;
  }
  return meta;
}
