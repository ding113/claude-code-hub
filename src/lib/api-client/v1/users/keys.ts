/**
 * /api/v1/users 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const usersKeys = {
  all: [...v1Keys.all, "users"] as const,
  list: (params?: Record<string, unknown>) => [...usersKeys.all, "list", params ?? {}] as const,
  detail: (id: number) => [...usersKeys.all, "detail", id] as const,
  tags: () => [...usersKeys.all, "tags"] as const,
  keyGroups: () => [...usersKeys.all, "key-groups"] as const,
};

export type UsersQueryKey = ReturnType<(typeof usersKeys)[Exclude<keyof typeof usersKeys, "all">]>;
