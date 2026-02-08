import type { ProxySession } from "./session";

/**
 * 流式响应（SSE）在“收到响应头”时无法确定成功与否：
 * - 上游可能返回 HTTP 200，但 body 是错误 JSON（假 200）
 * - 只有在 SSE 结束后才能做最终判定
 *
 * 该结构用于 Forwarder → ResponseHandler 之间传递“延迟结算”的必要信息，
 * 以便在流结束后更新熔断器、endpoint 成功率、以及 session 绑定。
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
  (session as SessionWithDeferred).deferredStreamingFinalization = meta;
}

export function consumeDeferredStreamingFinalization(
  session: ProxySession
): DeferredStreamingFinalization | null {
  const s = session as SessionWithDeferred;
  const meta = s.deferredStreamingFinalization ?? null;
  if (meta) {
    s.deferredStreamingFinalization = undefined;
  }
  return meta;
}

