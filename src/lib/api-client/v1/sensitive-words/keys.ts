/**
 * /api/v1/sensitive-words 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const sensitiveWordsKeys = {
  all: [...v1Keys.all, "sensitive-words"] as const,
  list: () => [...sensitiveWordsKeys.all, "list"] as const,
  cacheStats: () => [...sensitiveWordsKeys.all, "cache-stats"] as const,
};

export type SensitiveWordsQueryKey = ReturnType<
  (typeof sensitiveWordsKeys)[Exclude<keyof typeof sensitiveWordsKeys, "all">]
>;
