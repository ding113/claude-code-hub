"use server";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { modelPrices } from "@/drizzle/schema";
import type { ModelPrice, ModelPriceData, ModelPriceSource } from "@/types/model-price";
import { toModelPrice } from "./_shared/transformers";

/**
 * 分页查询参数
 */
export interface PaginationParams {
  page: number;
  pageSize: number;
  search?: string; // 可选的搜索关键词
  source?: ModelPriceSource; // 可选的来源过滤
}

/**
 * 分页查询结果
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * 获取指定模型的最新价格
 */
export async function findLatestPriceByModel(modelName: string): Promise<ModelPrice | null> {
  const [price] = await db
    .select({
      id: modelPrices.id,
      modelName: modelPrices.modelName,
      priceData: modelPrices.priceData,
      source: modelPrices.source,
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
 * 获取所有模型的最新价格（非分页版本，保持向后兼容）
 * 注意：使用原生SQL，因为涉及到ROW_NUMBER()窗口函数
 */
export async function findAllLatestPrices(): Promise<ModelPrice[]> {
  const query = sql`
    WITH latest_prices AS (
      SELECT
        model_name,
        MAX(created_at) as max_created_at
      FROM model_prices
      GROUP BY model_name
    ),
    latest_records AS (
      SELECT
        mp.id,
        mp.model_name,
        mp.price_data,
        mp.source,
        mp.created_at,
        mp.updated_at,
        ROW_NUMBER() OVER (PARTITION BY mp.model_name ORDER BY mp.id DESC) as rn
      FROM model_prices mp
      INNER JOIN latest_prices lp
        ON mp.model_name = lp.model_name
        AND mp.created_at = lp.max_created_at
    )
    SELECT
      id,
      model_name as "modelName",
      price_data as "priceData",
      source,
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM latest_records
    WHERE rn = 1
    ORDER BY model_name
  `;

  const result = await db.execute(query);
  return Array.from(result).map(toModelPrice);
}

/**
 * 分页获取所有模型的最新价格
 * 注意：使用原生SQL，因为涉及到ROW_NUMBER()窗口函数
 */
export async function findAllLatestPricesPaginated(
  params: PaginationParams
): Promise<PaginatedResult<ModelPrice>> {
  const { page, pageSize, search, source } = params;
  const offset = (page - 1) * pageSize;

  // 构建 WHERE 条件
  const buildWhereCondition = () => {
    const conditions: ReturnType<typeof sql>[] = [];
    if (search?.trim()) {
      conditions.push(sql`model_name ILIKE ${`%${search.trim()}%`}`);
    }
    if (source) {
      conditions.push(sql`source = ${source}`);
    }
    if (conditions.length === 0) return sql``;
    if (conditions.length === 1) return sql`WHERE ${conditions[0]}`;
    return sql`WHERE ${sql.join(conditions, sql` AND `)}`;
  };

  const whereCondition = buildWhereCondition();

  // 先获取总数
  const countQuery = sql`
    WITH latest_prices AS (
      SELECT
        model_name,
        MAX(created_at) as max_created_at
      FROM model_prices
      ${whereCondition}
      GROUP BY model_name
    ),
    latest_records AS (
      SELECT
        mp.id,
        ROW_NUMBER() OVER (PARTITION BY mp.model_name ORDER BY mp.id DESC) as rn
      FROM model_prices mp
      INNER JOIN latest_prices lp
        ON mp.model_name = lp.model_name
        AND mp.created_at = lp.max_created_at
    )
    SELECT COUNT(*) as total
    FROM latest_records
    WHERE rn = 1
  `;

  const [countResult] = await db.execute(countQuery);
  const total = Number(countResult.total);

  // 获取分页数据
  const dataQuery = sql`
    WITH latest_prices AS (
      SELECT
        model_name,
        MAX(created_at) as max_created_at
      FROM model_prices
      ${whereCondition}
      GROUP BY model_name
    ),
    latest_records AS (
      SELECT
        mp.id,
        mp.model_name,
        mp.price_data,
        mp.source,
        mp.created_at,
        mp.updated_at,
        ROW_NUMBER() OVER (PARTITION BY mp.model_name ORDER BY mp.id DESC) as rn
      FROM model_prices mp
      INNER JOIN latest_prices lp
        ON mp.model_name = lp.model_name
        AND mp.created_at = lp.max_created_at
    )
    SELECT
      id,
      model_name as "modelName",
      price_data as "priceData",
      source,
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM latest_records
    WHERE rn = 1
    ORDER BY model_name
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const result = await db.execute(dataQuery);
  const data = Array.from(result).map(toModelPrice);

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * 检查是否存在任意价格记录
 */
export async function hasAnyPriceRecords(): Promise<boolean> {
  const [row] = await db.select({ id: modelPrices.id }).from(modelPrices).limit(1);

  return !!row;
}

/**
 * 创建新的价格记录
 * @param source - 价格来源，默认为 'litellm'（同步时使用），手动添加时传入 'manual'
 */
export async function createModelPrice(
  modelName: string,
  priceData: ModelPriceData,
  source: ModelPriceSource = "litellm"
): Promise<ModelPrice> {
  const [price] = await db
    .insert(modelPrices)
    .values({
      modelName: modelName,
      priceData: priceData,
      source: source,
    })
    .returning({
      id: modelPrices.id,
      modelName: modelPrices.modelName,
      priceData: modelPrices.priceData,
      source: modelPrices.source,
      createdAt: modelPrices.createdAt,
      updatedAt: modelPrices.updatedAt,
    });

  return toModelPrice(price);
}

/**
 * 更新或插入模型价格（先删除旧记录，再插入新记录）
 * 用于手动维护单个模型价格，source 固定为 'manual'
 */
export async function upsertModelPrice(
  modelName: string,
  priceData: ModelPriceData
): Promise<ModelPrice> {
  // 先删除该模型的所有旧记录
  await db.delete(modelPrices).where(eq(modelPrices.modelName, modelName));

  // 插入新记录，source 固定为 'manual'
  return createModelPrice(modelName, priceData, "manual");
}

/**
 * 删除指定模型的所有价格记录（硬删除）
 */
export async function deleteModelPriceByName(modelName: string): Promise<void> {
  await db.delete(modelPrices).where(eq(modelPrices.modelName, modelName));
}

/**
 * 获取数据库中所有 source='manual' 的最新价格记录
 * 返回 Map<modelName, ModelPrice>
 */
export async function findAllManualPrices(): Promise<Map<string, ModelPrice>> {
  const query = sql`
    WITH latest_prices AS (
      SELECT
        model_name,
        MAX(created_at) as max_created_at
      FROM model_prices
      WHERE source = 'manual'
      GROUP BY model_name
    ),
    latest_records AS (
      SELECT
        mp.id,
        mp.model_name,
        mp.price_data,
        mp.source,
        mp.created_at,
        mp.updated_at,
        ROW_NUMBER() OVER (PARTITION BY mp.model_name ORDER BY mp.id DESC) as rn
      FROM model_prices mp
      INNER JOIN latest_prices lp
        ON mp.model_name = lp.model_name
        AND mp.created_at = lp.max_created_at
    )
    SELECT
      id,
      model_name as "modelName",
      price_data as "priceData",
      source,
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM latest_records
    WHERE rn = 1
  `;

  const result = await db.execute(query);
  const prices = Array.from(result).map(toModelPrice);

  const priceMap = new Map<string, ModelPrice>();
  for (const price of prices) {
    priceMap.set(price.modelName, price);
  }
  return priceMap;
}

/**
 * 批量创建价格记录
 */
