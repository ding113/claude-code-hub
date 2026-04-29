/**
 * /api/v1/error-rules 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const errorRulesKeys = {
  all: [...v1Keys.all, "error-rules"] as const,
  list: () => [...errorRulesKeys.all, "list"] as const,
  cacheStats: () => [...errorRulesKeys.all, "cache-stats"] as const,
};

export type ErrorRulesQueryKey = ReturnType<
  (typeof errorRulesKeys)[Exclude<keyof typeof errorRulesKeys, "all">]
>;
