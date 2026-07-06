import TOML from "@iarna/toml";
import type { ModelPriceData } from "@/types/model-price";
import { type CptParseResult, parseCptTable } from "./cpt-schema";

/** 云端价格表(CPT v1)地址;schema 见 https://cch-plus.com/pricing/v1/models.schema.json */
export const CLOUD_PRICE_TABLE_URL = "https://cch-plus.com/pricing/v1/models.json";
// 全量价格表约 10MB+,超时给足余量
const FETCH_TIMEOUT_MS = 30000;

export type CloudPriceTable = {
  metadata?: Record<string, unknown>;
  models: Record<string, ModelPriceData>;
};

export type CloudPriceTableResult<T> = { ok: true; data: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 解析旧版 TOML 价格表(仅保留给用户本地上传旧文件的兼容路径,
 * 云端同步已切换到 CPT v1 JSON)。
 */
export function parseCloudPriceTableToml(tomlText: string): CloudPriceTableResult<CloudPriceTable> {
  try {
    const parsed = TOML.parse(tomlText) as unknown;
    if (!isRecord(parsed)) {
      return { ok: false, error: "价格表格式无效：根节点不是对象" };
    }

    const modelsValue = parsed.models;
    if (!isRecord(modelsValue)) {
      return { ok: false, error: "价格表格式无效：缺少 models 表" };
    }

    const models: Record<string, ModelPriceData> = Object.create(null);
    for (const [modelName, value] of Object.entries(modelsValue)) {
      if (modelName === "__proto__" || modelName === "constructor" || modelName === "prototype") {
        continue;
      }
      if (!isRecord(value)) continue;
      models[modelName] = value as unknown as ModelPriceData;
    }

    if (Object.keys(models).length === 0) {
      return { ok: false, error: "价格表格式无效：models 为空" };
    }

    const metadataValue = parsed.metadata;
    const metadata = isRecord(metadataValue) ? metadataValue : undefined;

    return { ok: true, data: { metadata, models } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `价格表 TOML 解析失败: ${message}` };
  }
}

/** 拉取云端 CPT v1 价格表原文(JSON 文本) */
export async function fetchCloudPriceTableJson(
  url: string = CLOUD_PRICE_TABLE_URL
): Promise<CloudPriceTableResult<string>> {
  const expectedUrl = (() => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  })();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (expectedUrl && typeof response.url === "string" && response.url) {
      try {
        const finalUrl = new URL(response.url);
        if (
          finalUrl.protocol !== expectedUrl.protocol ||
          finalUrl.host !== expectedUrl.host ||
          finalUrl.pathname !== expectedUrl.pathname
        ) {
          return { ok: false, error: "云端价格表拉取失败：重定向到非预期地址" };
        }
      } catch {
        // response.url 无法解析时不阻断（仅作安全硬化），继续按原路径处理
      }
    }

    if (!response.ok) {
      return { ok: false, error: `云端价格表拉取失败：HTTP ${response.status}` };
    }

    const jsonText = await response.text();
    if (!jsonText.trim()) {
      return { ok: false, error: "云端价格表拉取失败：内容为空" };
    }

    return { ok: true, data: jsonText };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `云端价格表拉取失败：${message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 拉取并解析云端 CPT v1 价格表 */
export async function fetchAndParseCloudPriceTable(
  url: string = CLOUD_PRICE_TABLE_URL
): Promise<CptParseResult> {
  const fetched = await fetchCloudPriceTableJson(url);
  if (!fetched.ok) {
    return fetched;
  }
  return parseCptTable(fetched.data);
}
