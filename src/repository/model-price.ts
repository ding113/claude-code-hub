"use server";

import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { modelPrices } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import { buildModelNameFallbackCandidates } from "@/lib/utils/model-name-matching";
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
  vendor?: string; // 可选的云端 vendor 过滤（price_data.vendor）
  litellmProvider?: string; // 旧版云端提供商过滤（price_data.litellm_provider），仅遗留数据可命中
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
 * 获取指定模型的最新价格。
 *
 * 精确名未命中时按以下顺序回退(用于带斜杠/区域前缀/日期后缀等调用名变体):
 * 1. 归一化候选名(去托管商前缀、取最后一段、剥区域前缀等)的精确匹配
 * 2. 云端价格表 aliases 数组命中原名
 * 3. aliases 命中候选名
 */
export async function findLatestPriceByModel(modelName: string): Promise<ModelPrice | null> {
  try {
    const selection = {
      id: modelPrices.id,
      modelName: modelPrices.modelName,
      priceData: modelPrices.priceData,
      source: modelPrices.source,
      createdAt: modelPrices.createdAt,
      updatedAt: modelPrices.updatedAt,
    };

    const [price] = await db
      .select(selection)
      .from(modelPrices)
      .where(eq(modelPrices.modelName, modelName))
      .orderBy(
        sql`(${modelPrices.source} = 'manual') DESC`,
        sql`${modelPrices.createdAt} DESC NULLS LAST`,
        desc(modelPrices.id)
      )
      .limit(1);

    if (price) return toModelPrice(price);
    return await findLatestPriceByModelFallback(modelName);
  } catch (error) {
    logger.error("[ModelPrice] Failed to query latest price by model", {
      modelName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** 精确名未命中后的候选名/别名回退查询 */
async function findLatestPriceByModelFallback(modelName: string): Promise<ModelPrice | null> {
  const original = modelName.trim();
  if (!original) return null;

  const candidates = buildModelNameFallbackCandidates(original);
  const candidateArray = candidates.length > 0 ? candidates : [original];

  // 匹配优先级:候选名精确命中 > 别名命中原名 > 别名命中候选名;
  // 同级内 manual 优先、时间倒序。别名查询命中 idx_model_prices_aliases(GIN)。
  const query = sql`
    SELECT
      id,
      model_name as "modelName",
      price_data as "priceData",
      source,
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM model_prices
    WHERE model_name = ANY(${candidateArray})
       OR price_data -> 'aliases' ? ${original}
       OR price_data -> 'aliases' ?| ${candidateArray}
    ORDER BY
      CASE
        WHEN model_name = ANY(${candidateArray}) THEN 0
        WHEN price_data -> 'aliases' ? ${original} THEN 1
        ELSE 2
      END,
      COALESCE(array_position(${candidateArray}::text[], model_name), 2147483647),
      (source = 'manual') DESC,
      created_at DESC NULLS LAST,
      id DESC
    LIMIT 1
  `;

  const result = await db.execute(query);
  const rows = Array.from(result);
  if (rows.length === 0) return null;
  return toModelPrice(rows[0]);
}

export async function findLatestPriceByModelAndSource(
  modelName: string,
  source: ModelPriceSource
): Promise<ModelPrice | null> {
  try {
    const selection = {
      id: modelPrices.id,
      modelName: modelPrices.modelName,
      priceData: modelPrices.priceData,
      source: modelPrices.source,
      createdAt: modelPrices.createdAt,
      updatedAt: modelPrices.updatedAt,
    };

    const [price] = await db
      .select(selection)
      .from(modelPrices)
      .where(sql`${modelPrices.modelName} = ${modelName} AND ${modelPrices.source} = ${source}`)
      .orderBy(sql`${modelPrices.createdAt} DESC NULLS LAST`, desc(modelPrices.id))
      .limit(1);

    if (!price) return null;
    return toModelPrice(price);
  } catch (error) {
    logger.error("[ModelPrice] Failed to query latest price by model and source", {
      modelName,
      source,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function findLatestPricesByModels(
  modelNames: string[]
): Promise<Map<string, ModelPrice>> {
  const uniqueNames = Array.from(new Set(modelNames.map((name) => name.trim()).filter(Boolean)));
  if (uniqueNames.length === 0) {
    return new Map();
  }

  const query = sql`
    SELECT DISTINCT ON (model_name)
      id,
      model_name as "modelName",
      price_data as "priceData",
      source,
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM model_prices
    WHERE ${inArray(modelPrices.modelName, uniqueNames)}
    ORDER BY
      model_name,
      (source = 'manual') DESC,
      created_at DESC NULLS LAST,
      id DESC
  `;

  const result = await db.execute(query);
  const rows = Array.from(result).map(toModelPrice);
  return new Map(rows.map((row) => [row.modelName, row]));
}

/**
 * 获取所有模型的最新价格（非分页版本，保持向后兼容）
 * 注意：使用原生 SQL（DISTINCT ON），并确保 manual 来源优先
 */
export async function findAllLatestPrices(): Promise<ModelPrice[]> {
  const query = sql`
    SELECT DISTINCT ON (model_name)
      id,
      model_name as "modelName",
      price_data as "priceData",
      source,
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM model_prices
    ORDER BY
      model_name,
      (source = 'manual') DESC,
      created_at DESC NULLS LAST,
      id DESC
  `;

  const result = await db.execute(query);
  return Array.from(result).map(toModelPrice);
}

/**
 * 分页获取所有模型的最新价格
 * 注意：使用原生 SQL（DISTINCT ON），并确保 manual 来源优先
 */
export async function findAllLatestPricesPaginated(
  params: PaginationParams
): Promise<PaginatedResult<ModelPrice>> {
  const { page, pageSize, search, source, vendor, litellmProvider } = params;
  const offset = (page - 1) * pageSize;

  // 构建 WHERE 条件
  const buildWhereCondition = () => {
    const conditions: ReturnType<typeof sql>[] = [];
    if (search?.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(sql`(model_name ILIKE ${term} OR price_data->>'display_name' ILIKE ${term})`);
    }
    if (source === "cloud") {
      // 云端来源包含旧版 litellm 遗留行,避免切换期查询漏数据
      conditions.push(sql`source <> 'manual'`);
    } else if (source) {
      conditions.push(sql`source = ${source}`);
    }
    if (vendor?.trim()) {
      conditions.push(sql`price_data->>'vendor' = ${vendor.trim()}`);
    }
    if (litellmProvider?.trim()) {
      conditions.push(sql`price_data->>'litellm_provider' = ${litellmProvider.trim()}`);
    }
    if (conditions.length === 0) return sql``;
    if (conditions.length === 1) return sql`WHERE ${conditions[0]}`;
    return sql`WHERE ${sql.join(conditions, sql` AND `)}`;
  };

  const whereCondition = buildWhereCondition();

  // 先获取总数
  const countQuery = sql`
    SELECT COUNT(DISTINCT model_name) as total
    FROM model_prices
    ${whereCondition}
  `;

  const [countResult] = await db.execute(countQuery);
  const total = Number(countResult.total);

  // 获取分页数据
  // 子查询: DISTINCT ON 要求 ORDER BY 首列与其一致，用于去重选出每个模型的最优记录
  // 外层: 按 updatedAt 降序排列，最近更新的模型排在前面
  const dataQuery = sql`
    SELECT * FROM (
      SELECT DISTINCT ON (model_name)
        id,
        model_name as "modelName",
        price_data as "priceData",
        source,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM model_prices
      ${whereCondition}
      ORDER BY
        model_name,
        (source = 'manual') DESC,
        created_at DESC NULLS LAST,
        id DESC
    ) sub
    ORDER BY sub."updatedAt" DESC NULLS LAST
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
 * 用于手动维护单个模型价格或批量替换；source 默认为 'manual'。
 */
export async function upsertModelPrice(
  modelName: string,
  priceData: ModelPriceData,
  source: ModelPriceSource = "manual"
): Promise<ModelPrice> {
  // 使用事务确保删除和插入的原子性
  return await db.transaction(async (tx) => {
    // 先删除该模型的所有旧记录
    await tx.delete(modelPrices).where(eq(modelPrices.modelName, modelName));

    const [price] = await tx
      .insert(modelPrices)
      .values({
        modelName: modelName,
        priceData: priceData,
        source: source,
      })
      .returning();
    return toModelPrice(price);
  });
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
    SELECT DISTINCT ON (model_name)
      id,
      model_name as "modelName",
      price_data as "priceData",
      source,
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM model_prices
    WHERE source = 'manual'
    ORDER BY
      model_name,
      created_at DESC NULLS LAST,
      id DESC
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
 * 删除不在保留列表中的所有云端来源价格记录(source <> 'manual')。
 * 云端价格表整表切换/换代时清理陈旧模型;manual 记录不受影响。
 * @returns 删除的行数
 */
export async function deleteCloudPricesNotIn(keepModelNames: string[]): Promise<number> {
  // 空保留列表视为无效输入直接跳过:否则等同于清空全部非 manual 行
  if (keepModelNames.length === 0) return 0;
  const deletedRows = await db
    .delete(modelPrices)
    .where(and(ne(modelPrices.source, "manual"), notInArray(modelPrices.modelName, keepModelNames)))
    .returning({ id: modelPrices.id });
  return deletedRows.length;
}

/** 统计云端来源(source <> 'manual')的去重模型数量,用于同步一致性校验 */
export async function countCloudModelPrices(): Promise<number> {
  const [row] = await db.execute(sql`
    SELECT COUNT(DISTINCT model_name) AS total
    FROM model_prices
    WHERE source <> 'manual'
  `);
  return Number((row as { total?: unknown })?.total ?? 0);
}

/**
 * 批量创建价格记录
 */
