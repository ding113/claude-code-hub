/**
 * 绑定客户端中止监听器，返回幂等清理函数。
 *
 * 注意：如果传入的 signal 已经 aborted，会在当前调用栈同步执行 onAbort。
 * 调用方必须先初始化 onAbort 闭包会访问的控制器、任务 ID 等资源。
 */
export function bindClientAbortListener(
  signal: AbortSignal | null | undefined,
  onAbort: () => void
): () => void {
  if (!signal) {
    return () => {};
  }

  if (signal.aborted) {
    onAbort();
    return () => {};
  }

  let cleaned = false;
  signal.addEventListener("abort", onAbort, { once: true });

  return () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    // 正常完成时也要解绑，避免 listener 闭包继续持有 session 与请求体。
    signal.removeEventListener("abort", onAbort);
  };
}
