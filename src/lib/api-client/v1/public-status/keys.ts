/**
 * /api/v1/public/status 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const publicStatusKeys = {
  all: [...v1Keys.all, "public-status"] as const,
  status: () => [...publicStatusKeys.all, "status"] as const,
};

export type PublicStatusQueryKey = ReturnType<
  (typeof publicStatusKeys)[Exclude<keyof typeof publicStatusKeys, "all">]
>;
