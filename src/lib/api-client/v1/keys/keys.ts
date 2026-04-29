/**
 * /api/v1/keys 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const keysKeys = {
  all: [...v1Keys.all, "keys"] as const,
  listForUser: (userId: number, includeStatistics?: boolean) =>
    [...keysKeys.all, "list", userId, { includeStatistics: !!includeStatistics }] as const,
  limitUsage: (id: number) => [...keysKeys.all, "limit-usage", id] as const,
};

export type KeysQueryKey = ReturnType<(typeof keysKeys)[Exclude<keyof typeof keysKeys, "all">]>;
