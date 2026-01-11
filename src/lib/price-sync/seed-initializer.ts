/**
 * 价格表初始化服务（云端优先）
 *
 * 核心功能：
 * 1. 在应用启动时自动确保价格表存在（如果数据库为空）
 * 2. 数据库为空时从云端价格表拉取并写入数据库
 * 3. 降级策略：拉取/写入失败时记录警告但不阻塞启动
 */

import { logger } from "@/lib/logger";
import { syncCloudPriceTableToDatabase } from "@/lib/price-sync/cloud-price-updater";
import { hasAnyPriceRecords } from "@/repository/model-price";

/**
 * 确保价格表存在（主入口函数）
 *
 * 策略：
 * 1. 检查数据库是否有价格数据
 * 2. 如果为空，从云端价格表拉取并写入数据库
 * 3. 失败时记录警告但不阻塞应用启动
 */
export async function ensurePriceTable(): Promise<void> {
  try {
    // 检查数据库是否已有价格数据
    const hasPrices = await hasAnyPriceRecords();

    if (hasPrices) {
      logger.info("[PriceSync] Price table already exists, skipping initialization");
      return;
    }

    logger.info("[PriceSync] No price data found in database, syncing from cloud price table...");

    const result = await syncCloudPriceTableToDatabase();
    if (!result.ok) {
      logger.warn("[PriceSync] Failed to sync cloud price table for initialization", {
        error: result.error,
      });
      return;
    }

    logger.info("[PriceSync] Cloud price table synced for initialization", {
      added: result.data.added.length,
      updated: result.data.updated.length,
      total: result.data.total,
    });
  } catch (error) {
    // 不阻塞应用启动，用户仍可通过手动同步/更新来添加价格表
    logger.error("[PriceSync] Failed to ensure price table", {
      error: error,
    });
  }
}
