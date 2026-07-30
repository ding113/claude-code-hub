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
 * TPS = 输出 token / 生成窗口，生成窗口以真 TTFB 为起点。
 *
 * firstByteMs 缺失即返回 null：流式门禁上线前的历史行只有 TFFT，用它当分母会排除
 * 上游排队/中性帧窗口，系统性高估 TPS。
 */
export function computeTokensPerSecond(input: {
  outputTokens?: number | null;
  durationMs?: number | null;
  firstByteMs?: number | null;
}): number | null {
  if (!input.outputTokens || input.outputTokens <= 0) {
    return null;
  }

  if (!input.durationMs || input.durationMs <= 0) {
    return null;
  }

  if (input.firstByteMs == null) {
    return null;
  }

  const generationMs = input.durationMs - input.firstByteMs;
  if (generationMs <= 0) {
    return null;
  }

  return Number((input.outputTokens / (generationMs / 1000)).toFixed(4));
}
