"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getPriceTableJson } from "@/lib/price-sync";
import {
  createModelPrice,
  findAllLatestPrices,
  findAllLatestPricesPaginated,
  findLatestPriceByModel,
  hasAnyPriceRecords,
  type PaginatedResult,
  type PaginationParams,
} from "@/repository/model-price";
import type {
  ModelPrice,
  ModelPriceData,
  PriceTableJson,
  PriceUpdateResult,
} from "@/types/model-price";
import type { ActionResult } from "./types";

/**
 * 检查价格数据是否相同
 */
function isPriceDataEqual(data1: ModelPriceData, data2: ModelPriceData): boolean {
  // 深度比较两个价格对象
  return JSON.stringify(data1) === JSON.stringify(data2);
}

/**
 * 价格表处理核心逻辑（内部函数，无权限检查）
 * 用于系统初始化和 Web UI 上传
 */
export async function processPriceTableInternal(
  jsonContent: string
): Promise<ActionResult<PriceUpdateResult>> {
  try {
    // 解析JSON内容
    let priceTable: PriceTableJson;
    try {
      priceTable = JSON.parse(jsonContent);
    } catch {
      return { ok: false, error: "JSON格式不正确，请检查文件内容" };
    }

    // 验证是否为对象
    if (typeof priceTable !== "object" || priceTable === null) {
      return { ok: false, error: "价格表必须是一个JSON对象" };
    }

    // 元数据字段列表（不是实际的模型数据）
    const METADATA_FIELDS = ["sample_spec"];

    // 导入所有模型（过滤元数据字段）
    const entries = Object.entries(priceTable).filter(([modelName]) => {
      // 排除元数据字段
      if (METADATA_FIELDS.includes(modelName)) {
        logger.debug(`跳过元数据字段: ${modelName}`);
        return false;
      }
      return typeof modelName === "string" && modelName.trim().length > 0;
    });

    const result: PriceUpdateResult = {
      added: [],
      updated: [],
      unchanged: [],
      failed: [],
      total: entries.length,
    };

    // 处理每个模型的价格
    for (const [modelName, priceData] of entries) {
      try {
        // 验证价格数据基本类型
        if (typeof priceData !== "object" || priceData === null) {
          logger.warn(`模型 ${modelName} 的价格数据不是有效的对象`);
          result.failed.push(modelName);
          continue;
        }

        // 验证价格数据必须包含 mode 字段（所有有效模型都有这个字段）
        if (!("mode" in priceData)) {
          logger.warn(`模型 ${modelName} 缺少必需的 mode 字段，跳过处理`);
          result.failed.push(modelName);
          continue;
        }

        // 查找该模型的最新价格
        const existingPrice = await findLatestPriceByModel(modelName);

        if (!existingPrice) {
          // 模型不存在，新增记录
          await createModelPrice(modelName, priceData);
          result.added.push(modelName);
        } else if (!isPriceDataEqual(existingPrice.priceData, priceData)) {
          // 模型存在但价格发生变化，新增记录
          await createModelPrice(modelName, priceData);
          result.updated.push(modelName);
        } else {
          // 价格未发生变化，不需要更新
          result.unchanged.push(modelName);
        }
      } catch (error) {
        logger.error("处理模型 ${modelName} 失败:", error);
        result.failed.push(modelName);
      }
    }

    // 刷新页面数据
    revalidatePath("/settings/prices");

    return { ok: true, data: result };
  } catch (error) {
    logger.error("处理价格表失败:", error);
    const message = error instanceof Error ? error.message : "处理失败，请稍后重试";
    return { ok: false, error: message };
  }
}

/**
 * 上传并更新模型价格表（Web UI 入口，包含权限检查）
 */
export async function uploadPriceTable(
  jsonContent: string
): Promise<ActionResult<PriceUpdateResult>> {
  // 权限检查：只有管理员可以上传价格表
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "无权限执行此操作" };
  }

  // 调用核心逻辑
  return processPriceTableInternal(jsonContent);
}

/**
 * 获取所有模型的最新价格（包含 Claude 和 OpenAI 等所有模型）
 */
export async function getModelPrices(): Promise<ModelPrice[]> {
  try {
    // 权限检查：只有管理员可以查看价格表
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return [];
    }

    return await findAllLatestPrices();
  } catch (error) {
    logger.error("获取模型价格失败:", error);
    return [];
  }
}

/**
 * 分页获取所有模型的最新价格
 */
export async function getModelPricesPaginated(
  params: PaginationParams
): Promise<ActionResult<PaginatedResult<ModelPrice>>> {
  try {
    // 权限检查：只有管理员可以查看价格表
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: "无权限执行此操作",
      };
    }

    const result = await findAllLatestPricesPaginated(params);
    return {
      ok: true,
      data: result,
    };
  } catch (error) {
    logger.error("获取模型价格失败:", error);
    return {
      ok: false,
      error: "获取价格数据失败，请稍后重试",
    };
  }
}

/**
 * 检查是否存在价格表数据
 */
export async function hasPriceTable(): Promise<boolean> {
  try {
    const session = await getSession();

    if (session && session.user.role === "admin") {
      const prices = await getModelPrices();
      return prices.length > 0;
    }

    return await hasAnyPriceRecords();
  } catch (error) {
    logger.error("检查价格表失败:", error);
    return false;
  }
}

/**
 * 根据供应商类型获取可选择的模型列表
 * @param providerType - 供应商类型
 * @returns 模型名称列表（已排序）
 *
 * 注意：返回所有聊天模型，不区分 provider。
 * 理由：
 * - 非 Anthropic 提供商允许任意模型（符合业务需求）
 * - 用户可以通过手动输入添加任何模型
 * - 避免维护复杂的 provider 映射关系
 */
export async function getAvailableModelsByProviderType(): Promise<string[]> {
  try {
    // 权限检查：只有管理员可以查看
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return [];
    }

    const allPrices = await findAllLatestPrices();

    // 简化逻辑：返回所有聊天模型
    // 非 Anthropic 提供商本来就允许任意模型，精确过滤意义不大
    // 用户可以通过手动输入添加任何模型（见 ModelMultiSelect 组件）
    return allPrices
      .filter((price) => price.priceData.mode === "chat") // 仅聊天模型
      .map((price) => price.modelName)
      .sort(); // 字母排序
  } catch (error) {
    logger.error("获取可用模型列表失败:", error);
    return [];
  }
}

/**
 * 获取指定模型的最新价格
 */

/**
 * 从 LiteLLM CDN 同步价格表到数据库
 * @returns 同步结果
 */
export async function syncLiteLLMPrices(): Promise<ActionResult<PriceUpdateResult>> {
  try {
    // 权限检查：只有管理员可以同步价格表
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    logger.info("🔄 Starting LiteLLM price sync...");

    // 获取价格表 JSON（优先 CDN，降级缓存）
    const jsonContent = await getPriceTableJson();

    if (!jsonContent) {
      logger.error("❌ Failed to get price table from both CDN and cache");
      return {
        ok: false,
        error: "无法从 CDN 或缓存获取价格表，请检查网络连接或稍后重试",
      };
    }

    // 调用现有的上传逻辑（已包含权限检查，但这里直接处理以避免重复检查）
    const result = await uploadPriceTable(jsonContent);

    if (result.ok) {
      logger.info("LiteLLM price sync completed", { result: result.data });
    } else {
      logger.error("❌ LiteLLM price sync failed:", { context: result.error });
    }

    return result;
  } catch (error) {
    logger.error("❌ Sync LiteLLM prices failed:", error);
    const message = error instanceof Error ? error.message : "同步失败，请稍后重试";
    return { ok: false, error: message };
  }
}
