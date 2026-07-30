export interface PublicStatusConfiguredGroup {
  sourceGroupId?: number | null;
  sourceGroupName: string;
  publicGroupSlug: string;
  displayName: string;
  explanatoryCopy: string | null;
  sortOrder: number;
  models: Array<{
    publicModelKey: string;
    label: string;
    vendorIconKey: string;
    requestTypeBadge: string;
  }>;
}

/**
 * TPS = 输出 token / 生成窗口，生成窗口以 TTFT 为起点。
 *
 * ttftMs 缺失即返回 null：旧 timing 语义无法可靠还原首个有效内容时刻，不能参与 TPS。
 */
export function computeTokensPerSecond(input: {
  outputTokens?: number | null;
  durationMs?: number | null;
  ttftMs?: number | null;
}): number | null {
  if (!input.outputTokens || input.outputTokens <= 0) {
    return null;
  }

  if (!input.durationMs || input.durationMs <= 0) {
    return null;
  }

  if (input.ttftMs == null) {
    return null;
  }
  const generationMs = input.durationMs - input.ttftMs;
  if (generationMs <= 0) {
    return null;
  }

  return Number((input.outputTokens / (generationMs / 1000)).toFixed(4));
}
