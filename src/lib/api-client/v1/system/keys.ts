/**
 * /api/v1/system 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const systemKeys = {
  all: [...v1Keys.all, "system"] as const,
  settings: () => [...systemKeys.all, "settings"] as const,
  timezone: () => [...systemKeys.all, "timezone"] as const,
};

export type SystemQueryKey = ReturnType<
  (typeof systemKeys)[Exclude<keyof typeof systemKeys, "all">]
>;
