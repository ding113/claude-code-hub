/**
 * 组合多个 AbortSignal 为单个信号，并返回显式 cleanup。
 *
 * 优先使用原生 `AbortSignal.any`（Node.js 20.3+ / V8 内部管理 listener）。
 * 仅在原生不可用（例如 Next.js standalone 覆盖全局 AbortSignal）时使用 polyfill。
 *
 * Polyfill 路径必须由调用方在请求生命周期结束时调用 cleanup，否则源信号上的 abort
 * listener 会一直持有闭包（包含 combinedController、cleanups 数组及源信号引用），
 * 导致 session/请求体无法被 GC——和 #1113 修复的 client abort listener 是同一类泄漏。
 */
export interface CombinedAbortSignal {
  signal: AbortSignal;
  cleanup: () => void;
}

const NOOP_CLEANUP = () => {};

export function combineAbortSignals(signals: AbortSignal[]): CombinedAbortSignal {
  if ("any" in AbortSignal && typeof AbortSignal.any === "function") {
    return { signal: AbortSignal.any(signals), cleanup: NOOP_CLEANUP };
  }

  const combinedController = new AbortController();
  const detachers: Array<() => void> = [];
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const detach of detachers) {
      detach();
    }
    detachers.length = 0;
  };

  for (const signal of signals) {
    if (signal.aborted) {
      combinedController.abort();
      cleanup();
      break;
    }

    const abortHandler = () => {
      combinedController.abort();
      cleanup();
    };

    signal.addEventListener("abort", abortHandler, { once: true });
    detachers.push(() => {
      signal.removeEventListener("abort", abortHandler);
    });
  }

  return { signal: combinedController.signal, cleanup };
}
