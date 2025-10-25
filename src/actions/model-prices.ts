"use server";

import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { getSession } from "@/lib/auth";
import {
  findLatestPriceByModel,
  createModelPrice,
  findAllLatestPrices,
  hasAnyPriceRecords,
} from "@/repository/model-price";
import type {
  PriceTableJson,
  PriceUpdateResult,
  ModelPrice,
  ModelPriceData,
} from "@/types/model-price";
import type { ActionResult } from "./types";
import { getPriceTableJson } from "@/lib/price-sync";

/**
 * 检查价格数据是否相同
 */
function isPriceDataEqual(data1: ModelPriceData, data2: ModelPriceData): boolean {
  // 深度比较两个价格对象
  return JSON.stringify(data1) === JSON.stringify(data2);
}

/**
 * 上传并更新模型价格表
 */
export async function uploadPriceTable(
  jsonContent: string
): Promise<ActionResult<PriceUpdateResult>> {
  try {
    // 权限检查：只有管理员可以上传价格表
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

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

    // 扩展支持：Claude + OpenAI 模型
    const entries = Object.entries(priceTable).filter(([modelName]) => {
      if (typeof modelName !== "string") return false;
      const lowerName = modelName.toLowerCase();
      return (
        lowerName.startsWith("claude-") ||
        lowerName.startsWith("gpt-") ||
        lowerName.startsWith("o1-") ||
        lowerName.startsWith("o3-") // OpenAI 推理模型
      );
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
        // 验证价格数据
        if (typeof priceData !== "object" || priceData === null) {
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
    logger.error("上传价格表失败:", error);
    const message = error instanceof Error ? error.message : "上传失败，请稍后重试";
    return { ok: false, error: message };
  }
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
 * @param providerType - 供应商类型 ('claude' 或 'codex')
 * @returns 模型名称列表（已排序）
 */
export async function getAvailableModelsByProviderType(
  providerType: "claude" | "codex"
): Promise<string[]> {
  try {
    // 权限检查：只有管理员可以查看
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return [];
    }

    const allPrices = await findAllLatestPrices();

    // 供应商类型到 litellm_provider 的映射
    const targetProvider = providerType === "claude" ? "anthropic" : "openai";

    // 过滤聊天模型并返回模型名称
    return allPrices
      .filter(
        (price) =>
          price.priceData.litellm_provider === targetProvider &&
          price.priceData.mode === "chat" // 仅聊天模型
      )
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
      logger.info("✅ LiteLLM price sync completed", { result: result.data });
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
