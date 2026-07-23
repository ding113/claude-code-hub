import { fingerprintTip } from "@/app/v1/_lib/proxy/affinity/fingerprint";
import type { SessionAffinityState } from "@/app/v1/_lib/proxy/session";

/**
 * F3b 缓存效果门控（CCHP finalize/cache_score.go 的移植，纯函数无 IO）。
 *
 * 在流式终态结算时派生 message_request 的缓存模拟列：
 * - cacheCompatibilityKey：scopeTag:fp（优先级 Matched > Tip > Sys）——
 *   同 key 请求理论上可命中同一供应商 prompt cache，聚合任务按此回测。
 * - cacheScoreEligible / excludedReason：只有成功交付、上游可观测、非截断的
 *   请求才纳入窗口聚合，避免污染供应商缓存回测。
 * - theoreticalCacheTokens：按 tip 边界的规范化前缀字节粗估（bytes/4），
 *   表示「本请求理论可命中的缓存量上限」。
 *
 * 门控顺序（短路）：no_affinity_key -> attempt_failed -> not_observable -> stream_truncated -> eligible。
 * （replay serve 走 guard 短路不经流式终态；hedge 败者在独立计费行——两者天然不入本路径。）
 */

export const CACHE_SCORE_EXCLUDED = {
  noAffinityKey: "no_affinity_key",
  attemptFailed: "attempt_failed",
  notObservable: "not_observable",
  streamTruncated: "stream_truncated",
} as const;

export interface CacheScoreInput {
  affinity: SessionAffinityState | null;
  /** 终态是否 2xx 成功 */
  succeeded: boolean;
  /** 上游是否报告了可观测 usage（input tokens 存在） */
  usageObservable: boolean;
  /** 流是否被截断（未自然结束） */
  streamTruncated: boolean;
  /** 实际应用的 cache TTL（"5m"/"1h" 等），缺省归入 "5m" 桶 */
  cacheTtl: string | null;
}

export interface CacheScoreFields {
  cacheCompatibilityKey: string | null;
  cacheScoreEligible: boolean;
  cacheScoreExcludedReason: string | null;
  theoreticalCacheTokens: number | null;
  cacheTtlBucket: string | null;
}

/** 规范化字节 -> token 粗估系数（英文 ~4 bytes/token 的通用近似） */
const BYTES_PER_TOKEN = 4;

export function computeCacheScoreFields(input: CacheScoreInput): CacheScoreFields {
  const affinity = input.affinity;
  const matchedFp = affinity?.matchedFp ?? null;
  const tip = affinity ? fingerprintTip(affinity.chain) : null;
  const fp = matchedFp ?? tip?.fp ?? affinity?.chain.sys.fp ?? null;

  if (!affinity || !fp) {
    return {
      cacheCompatibilityKey: null,
      cacheScoreEligible: false,
      cacheScoreExcludedReason: CACHE_SCORE_EXCLUDED.noAffinityKey,
      theoreticalCacheTokens: null,
      cacheTtlBucket: null,
    };
  }

  const key = `${affinity.scopeTag}:${fp}`;
  const theoreticalCacheTokens = tip ? Math.floor(tip.prefixBytes / BYTES_PER_TOKEN) : null;
  const cacheTtlBucket = input.cacheTtl && input.cacheTtl.length > 0 ? input.cacheTtl : "5m";

  const base = {
    cacheCompatibilityKey: key,
    theoreticalCacheTokens,
    cacheTtlBucket,
  };

  if (!input.succeeded) {
    return {
      ...base,
      cacheScoreEligible: false,
      cacheScoreExcludedReason: CACHE_SCORE_EXCLUDED.attemptFailed,
    };
  }
  if (!input.usageObservable) {
    return {
      ...base,
      cacheScoreEligible: false,
      cacheScoreExcludedReason: CACHE_SCORE_EXCLUDED.notObservable,
    };
  }
  if (input.streamTruncated) {
    return {
      ...base,
      cacheScoreEligible: false,
      cacheScoreExcludedReason: CACHE_SCORE_EXCLUDED.streamTruncated,
    };
  }
  return { ...base, cacheScoreEligible: true, cacheScoreExcludedReason: null };
}
