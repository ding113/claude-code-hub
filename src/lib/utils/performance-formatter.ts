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
 * Determine if output rate should be hidden due to blocked streaming request.
 * Rule: Hide when generationTimeMs / durationMs < 0.1 AND outputRate > 5000
 * This indicates TTFB is very close to total duration with abnormally high tok/s.
 */
export function shouldHideOutputRate(
  outputRate: number | null,
  durationMs: number | null,
  ttfbMs: number | null
): boolean {
  if (
    outputRate == null ||
    !Number.isFinite(outputRate) ||
    durationMs == null ||
    durationMs <= 0 ||
    ttfbMs == null
  ) {
    return false;
  }
  const generationTimeMs = durationMs - ttfbMs;
  if (generationTimeMs <= 0) return false;
  const ratio = generationTimeMs / durationMs;
  return ratio < 0.1 && outputRate > 5000;
}
