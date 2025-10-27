"use server";

import { db } from "@/drizzle/db";
import { modelPrices } from "@/drizzle/schema";
import { eq, desc, sql } from "drizzle-orm";
import type { ModelPrice, ModelPriceData } from "@/types/model-price";
import { toModelPrice } from "./_shared/transformers";

/**
 * 获取指定模型的最新价格
 */
export async function findLatestPriceByModel(modelName: string): Promise<ModelPrice | null> {
  const [price] = await db
    .select({
      id: modelPrices.id,
      modelName: modelPrices.modelName,
      priceData: modelPrices.priceData,
      createdAt: modelPrices.createdAt,
      updatedAt: modelPrices.updatedAt,
    })
    .from(modelPrices)
    .where(eq(modelPrices.modelName, modelName))
    .orderBy(desc(modelPrices.createdAt))
    .limit(1);

  if (!price) return null;
  return toModelPrice(price);
}

/**
 * 获取所有模型的最新价格
 * 注意：使用原生SQL，因为涉及到ROW_NUMBER()窗口函数
 */
export async function findAllLatestPrices(): Promise<ModelPrice[]> {
  const query = sql`
    WITH used_models AS (
      SELECT DISTINCT LOWER(model) AS model
      FROM message_request
      WHERE deleted_at IS NULL
        AND model IS NOT NULL
        AND model != ''
    ),
    usage_stats AS (
      SELECT COUNT(*) AS used_count FROM used_models
    ),
    latest_prices AS (
      SELECT
        mp.id,
        mp.model_name,
        mp.price_data,
        mp.created_at,
        mp.updated_at,
        ROW_NUMBER() OVER (PARTITION BY mp.model_name ORDER BY mp.id DESC) as rn
      FROM model_prices mp
    )
    SELECT
      lp.id,
      lp.model_name AS "modelName",
      lp.price_data AS "priceData",
      lp.created_at AS "createdAt",
      lp.updated_at AS "updatedAt"
    FROM latest_prices lp
    CROSS JOIN usage_stats us
    WHERE lp.rn = 1
      AND (
        (us.used_count = 0 AND lp.model_name ILIKE '%claude%')
        OR (us.used_count > 0 AND EXISTS (
          SELECT 1 FROM used_models um
          WHERE um.model = LOWER(lp.model_name)
        ))
      )
    ORDER BY lp.model_name
  `;

  const result = await db.execute(query);
  return Array.from(result).map(toModelPrice);
}

/**
 * 检查是否存在任意价格记录
 */
export async function hasAnyPriceRecords(): Promise<boolean> {
  const [row] = await db
    .select({ id: modelPrices.id })
    .from(modelPrices)
    .limit(1);

  return !!row;
}

/**
 * 创建新的价格记录
 */
export async function createModelPrice(
  modelName: string,
  priceData: ModelPriceData
): Promise<ModelPrice> {
  const [price] = await db
    .insert(modelPrices)
    .values({
      modelName: modelName,
      priceData: priceData,
    })
    .returning({
      id: modelPrices.id,
      modelName: modelPrices.modelName,
      priceData: modelPrices.priceData,
      createdAt: modelPrices.createdAt,
      updatedAt: modelPrices.updatedAt,
    });

  return toModelPrice(price);
}

/**
 * 批量创建价格记录
 */
