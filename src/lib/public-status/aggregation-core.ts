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

export function computeTokensPerSecond(input: {
  outputTokens?: number | null;
  durationMs?: number | null;
  ttfbMs?: number | null;
}): number | null {
  if (!input.outputTokens || input.outputTokens <= 0) {
    return null;
  }

  if (!input.durationMs || input.durationMs <= 0) {
    return null;
  }

  const generationMs = input.durationMs - (input.ttfbMs ?? 0);
  if (generationMs <= 0) {
    return null;
  }

  return Number((input.outputTokens / (generationMs / 1000)).toFixed(4));
}
