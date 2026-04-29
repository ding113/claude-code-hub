/**
 * /api/v1/request-filters 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const requestFiltersKeys = {
  all: [...v1Keys.all, "request-filters"] as const,
  list: () => [...requestFiltersKeys.all, "list"] as const,
  providerOptions: () => [...requestFiltersKeys.all, "options", "providers"] as const,
  groupOptions: () => [...requestFiltersKeys.all, "options", "groups"] as const,
};

export type RequestFiltersQueryKey = ReturnType<
  (typeof requestFiltersKeys)[Exclude<keyof typeof requestFiltersKeys, "all">]
>;
