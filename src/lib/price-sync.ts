/**
 * LiteLLM 价格表自动同步服务
 *
 * 核心功能：
 * 1. 从 CDN 获取 LiteLLM 价格表
 * 2. 失败时使用本地缓存降级
 * 3. 成功后更新数据库并刷新缓存
 */

import fs from "node:fs/promises";
import path from "node:path";
import { isClientAbortError } from "@/app/v1/_lib/proxy/errors";
import { logger } from "@/lib/logger";

const LITELLM_PRICE_URL =
  "https://jsd-proxy.ygxz.in/gh/BerriAI/litellm/model_prices_and_context_window.json";
const CACHE_FILE_PATH = path.join(process.cwd(), "public", "cache", "litellm-prices.json");
const FETCH_TIMEOUT_MS = 10000; // 10 秒超时

/**
 * 确保缓存目录存在
 */
async function ensureCacheDirectory(): Promise<void> {
  const cacheDir = path.dirname(CACHE_FILE_PATH);
  try {
    await fs.access(cacheDir);
  } catch {
    await fs.mkdir(cacheDir, { recursive: true });
  }
}

/**
 * 从 CDN 获取 LiteLLM 价格表 JSON 字符串
 * @returns JSON 字符串或 null（失败时）
 */
export async function fetchLiteLLMPrices(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(LITELLM_PRICE_URL, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.error("❌ Failed to fetch LiteLLM prices: HTTP ${response.status}");
      return null;
    }

    const jsonText = await response.text();

    // 验证 JSON 格式
    JSON.parse(jsonText);

    logger.info("Successfully fetched LiteLLM prices from CDN");
    return jsonText;
  } catch (error) {
    if (error instanceof Error) {
      if (isClientAbortError(error)) {
        logger.error("❌ Fetch LiteLLM prices timeout after 10s");
      } else {
        logger.error("❌ Failed to fetch LiteLLM prices:", { context: error.message });
      }
    }
    return null;
  }
}

/**
 * 从本地缓存读取价格表
 * @returns JSON 字符串或 null（缓存不存在或损坏）
 */
export async function readCachedPrices(): Promise<string | null> {
  try {
    const cached = await fs.readFile(CACHE_FILE_PATH, "utf-8");

    // 验证 JSON 格式
    JSON.parse(cached);

    logger.info("📦 Using cached LiteLLM prices");
    return cached;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      logger.info("ℹ️  No cached prices found");
    } else {
      logger.error("❌ Failed to read cached prices:", error);
    }
    return null;
  }
}

/**
 * 将价格表保存到本地缓存
 * @param jsonText - JSON 字符串
 */
export async function saveCachedPrices(jsonText: string): Promise<void> {
  try {
    await ensureCacheDirectory();
    await fs.writeFile(CACHE_FILE_PATH, jsonText, "utf-8");
    logger.info("💾 Saved prices to cache");
  } catch (error) {
    logger.error("❌ Failed to save prices to cache:", error);
  }
}

/**
 * 获取价格表 JSON（优先 CDN，降级缓存）
 * @returns JSON 字符串或 null
 */
export async function getPriceTableJson(): Promise<string | null> {
  // 优先从 CDN 获取
  const jsonText = await fetchLiteLLMPrices();

  if (jsonText) {
    // 成功后更新缓存
    await saveCachedPrices(jsonText);
    return jsonText;
  }

  // 失败时降级使用缓存
  logger.info("⚠️  CDN fetch failed, trying cache...");
  return await readCachedPrices();
}
