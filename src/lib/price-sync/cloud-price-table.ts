import TOML from "@iarna/toml";
import type { ModelPriceData } from "@/types/model-price";

export const CLOUD_PRICE_TABLE_URL = "https://claude-code-hub.app/config/prices-base.toml";
const FETCH_TIMEOUT_MS = 10000;

export type CloudPriceTable = {
  metadata?: Record<string, unknown>;
  models: Record<string, ModelPriceData>;
};

export type CloudPriceTableResult<T> = { ok: true; data: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export async function fetchCloudPriceTableToml(
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
        Accept: "text/plain",
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

    const tomlText = await response.text();
    if (!tomlText.trim()) {
      return { ok: false, error: "云端价格表拉取失败：内容为空" };
    }

    return { ok: true, data: tomlText };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `云端价格表拉取失败：${message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}
