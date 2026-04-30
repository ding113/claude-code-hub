/**
 * /api/v1/model-prices 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const modelPricesKeys = {
  all: [...v1Keys.all, "model-prices"] as const,
  list: (params?: Record<string, unknown>) =>
    [...modelPricesKeys.all, "list", params ?? {}] as const,
  exists: () => [...modelPricesKeys.all, "exists"] as const,
  catalog: (scope?: "chat" | "all") =>
    [...modelPricesKeys.all, "catalog", scope ?? "chat"] as const,
  detail: (modelName: string) => [...modelPricesKeys.all, "detail", modelName] as const,
};

export type ModelPricesQueryKey = ReturnType<
  (typeof modelPricesKeys)[Exclude<keyof typeof modelPricesKeys, "all">]
>;
