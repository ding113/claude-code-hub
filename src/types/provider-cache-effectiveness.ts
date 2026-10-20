// F3b 缓存效果窗口聚合行。bp = 万分比整数,仅指标展示。
export interface ProviderCacheEffectivenessWindow {
  id: number;
  providerId: number;
  model: string;
  cacheTtlBucket: string;
  windowStart: Date;
  windowEnd: Date;
  sampleCount: number;
  eligibleCount: number;
  theoreticalCacheTokens: number;
  observedCacheReadTokens: number;
  rawEffectivenessBp: number;
  confidenceBp: number;
  effectivenessBp: number;
  createdAt: Date | null;
}
