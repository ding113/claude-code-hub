/**
 * /api/v1/providers TanStack Query keys
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const providersKeys = {
  all: [...v1Keys.all, "providers"] as const,
  list: (params?: Record<string, unknown>) => [...providersKeys.all, "list", params ?? {}] as const,
  detail: (id: number) => [...providersKeys.all, "detail", id] as const,
  health: () => [...providersKeys.all, "health"] as const,
  groups: (params?: Record<string, unknown>) =>
    [...providersKeys.all, "groups", params ?? {}] as const,
};

export type ProvidersQueryKey = ReturnType<
  (typeof providersKeys)[Exclude<keyof typeof providersKeys, "all">]
>;
