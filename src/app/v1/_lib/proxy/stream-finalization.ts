import type { SessionBindingSnapshot } from "@/lib/redis/session-binding";
import type { ProxySession } from "./session";

export type DeferredStreamingDiscoveryLease = {
  sessionId: string;
  keyId: number;
  ownerToken: string;
  ttlSeconds: number;
};

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
 * - 这里选择使用 WeakMap，而不是把字段挂到 session 上：
 *   - 避免污染 ProxySession 对象；
 *   - 更类型安全；
 *   - 元信息生命周期跟随 session 实例，消费后可立即清理。
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
  /** When true, commitWinner() already performed session binding and chain logging; finalization should skip them. */
  isHedgeWinner?: boolean;
  /**
   * Whether hedge-loser billing was enabled for this request. When true and this
   * is a hedge winner, the winner's cost is written additively (from zero) so it
   * coexists with asynchronously accumulated loser costs without clobbering.
   */
  billHedgeLosers?: boolean;
  /** Discovery delays binding until the stream has a valid completion marker. */
  bindingIntent?: "create" | "renew" | "none";
  bindingSnapshot?: SessionBindingSnapshot | null;
  /** Discovery winners must satisfy the protocol completion marker before binding. */
  requiresCompletionMarker?: boolean;
  /** Lease already acquired by Forwarder and owned until terminal side effects finish. */
  discoveryLease?: DeferredStreamingDiscoveryLease;
  /** Whether this attempt owns a Provider concurrent-session reference. */
  providerSessionRefOwned?: boolean;
  /** CAS success converts this attempt ref into the binding baseline when true. */
  providerSessionRefRetainOnSuccess?: boolean;
};

const deferredMeta = new WeakMap<ProxySession, DeferredStreamingFinalization>();

export function setDeferredStreamingFinalization(
  session: ProxySession,
  meta: DeferredStreamingFinalization
): void {
  // Forwarder 在识别到 SSE 时调用：标记该请求需要在流结束后“二次结算”。
  deferredMeta.set(session, meta);
}

/**
 * Read the deferred finalization meta WITHOUT consuming it. Used by non-SSE
 * finalization paths (e.g. Gemini passthrough via finalizeRequestStats) that do not
 * run the deferred finalizer but still need to know whether this is a hedge winner
 * with loser billing, so the winner cost write uses the loser-sum-aware mode.
 */
export function peekDeferredStreamingFinalization(
  session: ProxySession
): DeferredStreamingFinalization | null {
  return deferredMeta.get(session) ?? null;
}

export function consumeDeferredStreamingFinalization(
  session: ProxySession
): DeferredStreamingFinalization | null {
  // 备注：
  // - 该函数内部无 await；JS 事件循环保证单次调用不会被并发打断。
  // - ProxySession 是“每次请求”创建的实例；即使多个后台任务先后调用，
  //   也只有第一次能拿到 meta，其余调用都会得到 null。
  const meta = deferredMeta.get(session) ?? null;
  if (meta) {
    // 只允许消费一次：避免重复结算（例如多个后台统计任务并行时）。
    deferredMeta.delete(session);
  }
  return meta;
}
