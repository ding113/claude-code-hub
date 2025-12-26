import type { ModelPriceData } from "./model-price";

export type ModelPriceSourceV2 = "remote" | "local" | "user";

export interface ModelPriceV2 {
  id: number;
  modelName: string;
  priceData: ModelPriceData;
  source: ModelPriceSourceV2;
  isUserOverride: boolean;
  remoteVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}
