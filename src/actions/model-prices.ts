"use server";

import { revalidatePath } from "next/cache";
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

/**
 * 检查价格数据是否相同
 */
function isPriceDataEqual(
  data1: ModelPriceData,
  data2: ModelPriceData
): boolean {
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

    const entries = Object.entries(priceTable).filter(([modelName]) =>
      typeof modelName === "string" && modelName.length > 0
    );

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
        console.error(`处理模型 ${modelName} 失败:`, error);
        result.failed.push(modelName);
      }
    }

    // 刷新页面数据
    revalidatePath("/settings/prices");

    return { ok: true, data: result };
  } catch (error) {
    console.error("上传价格表失败:", error);
    const message =
      error instanceof Error ? error.message : "上传失败，请稍后重试";
    return { ok: false, error: message };
  }
}

/**
 * 获取所有模型的最新价格
 * 如果尚无调用记录，默认返回包含 “claude” 的模型
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
    console.error("获取模型价格失败:", error);
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
    console.error("检查价格表失败:", error);
    return false;
  }
}

/**
 * 获取指定模型的最新价格
 */
