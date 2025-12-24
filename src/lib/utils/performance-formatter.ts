export const NON_BILLING_ENDPOINT = "/v1/messages/count_tokens";

/**
 * 格式化请求耗时
 * - 1000ms 以上显示为秒（如 "1.23s"）
 * - 1000ms 以下显示为毫秒（如 "850ms"）
 */
export function formatDuration(durationMs: number | null): string {
  if (durationMs == null) return "-";

  // 1000ms 以上转换为秒
  if (durationMs >= 1000) {
    return `${(Number(durationMs) / 1000).toFixed(2)}s`;
  }

  // 1000ms 以下显示毫秒
  return `${durationMs}ms`;
}

/**
 * 计算输出速率（tokens/second）
 */
export function calculateOutputRate(
  outputTokens: number | null,
  durationMs: number | null,
  ttfbMs: number | null
): number | null {
  if (outputTokens == null || outputTokens <= 0 || durationMs == null || durationMs <= 0) {
    return null;
  }
  const generationTimeMs = ttfbMs != null ? durationMs - ttfbMs : durationMs;
  if (generationTimeMs <= 0) return null;
  return outputTokens / (generationTimeMs / 1000);
}

/**
 * 格式化性能第二行：TTFB | tok/s
 */
export function formatPerformanceSecondLine(
  ttfbMs: number | null,
  durationMs: number | null,
  outputTokens: number | null
): string {
  if (durationMs == null) return "-";
  const parts: string[] = [];
  if (ttfbMs != null && ttfbMs > 0) {
    parts.push(`TTFB ${formatDuration(ttfbMs)}`);
  }
  const rate = calculateOutputRate(outputTokens, durationMs, ttfbMs);
  if (rate !== null) {
    parts.push(`${rate.toFixed(0)} tok/s`);
  }
  return parts.length > 0 ? parts.join(" | ") : "";
}
