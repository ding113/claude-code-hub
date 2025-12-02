/**
 * 价格表种子数据初始化服务
 *
 * 核心功能：
 * 1. 从本地种子文件读取价格表
 * 2. 在应用启动时自动初始化价格表（如果数据库为空）
 * 3. 降级策略：种子文件读取失败时记录警告但不阻塞启动
 */

import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "@/lib/logger";
import { hasAnyPriceRecords } from "@/repository/model-price";

const SEED_PRICE_FILE_PATH = path.join(process.cwd(), "public", "seed", "litellm-prices.json");

/**
 * 从本地种子文件读取价格表
 * @returns JSON 字符串或 null（文件不存在或损坏）
 */
export async function readSeedPriceTable(): Promise<string | null> {
  try {
    const seedData = await fs.readFile(SEED_PRICE_FILE_PATH, "utf-8");

    // 验证 JSON 格式
    JSON.parse(seedData);

    logger.info("📦 Successfully read seed price table");
    return seedData;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      logger.warn("⚠️  Seed price table not found at:", { path: SEED_PRICE_FILE_PATH });
    } else {
      logger.error("❌ Failed to read seed price table:", error);
    }
    return null;
  }
}

/**
 * 从种子文件初始化价格表到数据库
 * @returns 是否成功初始化
 */
export async function initializePriceTableFromSeed(): Promise<boolean> {
  try {
    logger.info("🌱 Initializing price table from seed data...");

    // 读取种子文件
    const seedJson = await readSeedPriceTable();

    if (!seedJson) {
      logger.warn("⚠️  Seed price table unavailable, skipping initialization");
      return false;
    }

    // 动态导入以避免循环依赖
    // 直接调用内部函数，无需权限检查（系统启动时的自动初始化）
    const { processPriceTableInternal } = await import("@/actions/model-prices");

    const result = await processPriceTableInternal(seedJson);

    if (!result.ok) {
      logger.error("❌ Failed to initialize price table from seed:", { error: result.error });
      return false;
    }

    if (result.data) {
      logger.info("Price table initialized from seed", {
        added: result.data.added.length,
        total: result.data.total,
      });
    }

    return true;
  } catch (error) {
    logger.error("❌ Failed to initialize price table from seed:", error);
    return false;
  }
}

/**
 * 确保价格表存在（主入口函数）
 *
 * 策略：
 * 1. 检查数据库是否有价格数据
 * 2. 如果为空，从种子文件导入
 * 3. 失败时记录警告但不阻塞应用启动
 */
export async function ensurePriceTable(): Promise<void> {
  try {
    // 检查数据库是否已有价格数据
    const hasPrices = await hasAnyPriceRecords();

    if (hasPrices) {
      logger.info("✓ Price table already exists, skipping seed initialization");
      return;
    }

    logger.info("ℹ️  No price data found in database, initializing from seed...");

    // 从种子文件初始化
    await initializePriceTableFromSeed();
  } catch (error) {
    // 不阻塞应用启动，用户仍可通过手动同步/更新来添加价格表
    logger.error("❌ Failed to ensure price table:", error);
  }
}
