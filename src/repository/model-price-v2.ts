"use server";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { modelPricesV2 } from "@/drizzle/schema-v2";
import type { ModelPriceData } from "@/types/model-price";
import type { ModelPriceSourceV2, ModelPriceV2 } from "@/types/model-price-v2";
import { toModelPriceV2 } from "./_shared/transformers";

export interface CreateModelPriceV2Data {
  modelName: string;
  priceData: ModelPriceData;
  source: ModelPriceSourceV2;
  isUserOverride?: boolean;
  remoteVersion?: string | null;
}

export async function createModelPriceV2(data: CreateModelPriceV2Data): Promise<ModelPriceV2> {
  const [price] = await db
    .insert(modelPricesV2)
    .values({
      modelName: data.modelName,
      priceData: data.priceData,
      source: data.source,
      isUserOverride: data.isUserOverride ?? false,
      remoteVersion: data.remoteVersion ?? null,
    })
    .returning({
      id: modelPricesV2.id,
      modelName: modelPricesV2.modelName,
      priceData: modelPricesV2.priceData,
      source: modelPricesV2.source,
      isUserOverride: modelPricesV2.isUserOverride,
      remoteVersion: modelPricesV2.remoteVersion,
      createdAt: modelPricesV2.createdAt,
      updatedAt: modelPricesV2.updatedAt,
    });

  return toModelPriceV2(price);
}

export async function findLatestPriceV2ByModel(modelName: string): Promise<ModelPriceV2 | null> {
  const [price] = await db
    .select({
      id: modelPricesV2.id,
      modelName: modelPricesV2.modelName,
      priceData: modelPricesV2.priceData,
      source: modelPricesV2.source,
      isUserOverride: modelPricesV2.isUserOverride,
      remoteVersion: modelPricesV2.remoteVersion,
      createdAt: modelPricesV2.createdAt,
      updatedAt: modelPricesV2.updatedAt,
    })
    .from(modelPricesV2)
    .where(eq(modelPricesV2.modelName, modelName))
    .orderBy(desc(modelPricesV2.createdAt))
    .limit(1);

  if (!price) return null;
  return toModelPriceV2(price);
}

export async function findAllLatestPricesV2(): Promise<ModelPriceV2[]> {
  const query = sql`
    WITH latest_prices AS (
      SELECT
        model_name,
        MAX(created_at) as max_created_at
      FROM model_prices_v2
      GROUP BY model_name
    ),
    latest_records AS (
      SELECT
        mp.id,
        mp.model_name,
        mp.price_data,
        mp.source,
        mp.is_user_override,
        mp.remote_version,
        mp.created_at,
        mp.updated_at,
        ROW_NUMBER() OVER (PARTITION BY mp.model_name ORDER BY mp.id DESC) as rn
      FROM model_prices_v2 mp
      INNER JOIN latest_prices lp
        ON mp.model_name = lp.model_name
        AND mp.created_at = lp.max_created_at
    )
    SELECT
      id,
      model_name as "modelName",
      price_data as "priceData",
      source,
      is_user_override as "isUserOverride",
      remote_version as "remoteVersion",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM latest_records
    WHERE rn = 1
    ORDER BY model_name
  `;

  const result = await db.execute(query);
  return Array.from(result).map(toModelPriceV2);
}

export async function findModelPriceV2ById(id: number): Promise<ModelPriceV2 | null> {
  const [price] = await db
    .select({
      id: modelPricesV2.id,
      modelName: modelPricesV2.modelName,
      priceData: modelPricesV2.priceData,
      source: modelPricesV2.source,
      isUserOverride: modelPricesV2.isUserOverride,
      remoteVersion: modelPricesV2.remoteVersion,
      createdAt: modelPricesV2.createdAt,
      updatedAt: modelPricesV2.updatedAt,
    })
    .from(modelPricesV2)
    .where(eq(modelPricesV2.id, id))
    .limit(1);

  if (!price) return null;
  return toModelPriceV2(price);
}

export async function deleteModelPriceV2ById(id: number): Promise<boolean> {
  const result = await db.delete(modelPricesV2).where(eq(modelPricesV2.id, id)).returning({
    id: modelPricesV2.id,
  });

  return result.length > 0;
}
