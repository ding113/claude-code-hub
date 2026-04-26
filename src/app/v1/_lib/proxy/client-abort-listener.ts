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
