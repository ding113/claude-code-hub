import { AsyncTaskManager } from "@/lib/async-task-manager";
import { logger } from "@/lib/logger";
import type { PriceUpdateResult } from "@/types/model-price";
import {
  type CloudPriceTableResult,
  fetchCloudPriceTableToml,
  parseCloudPriceTableToml,
} from "./cloud-price-table";

/**
 * 拉取云端 TOML 价格表并写入数据库（不覆盖 manual，本地优先）。
 *
 * 说明：
 * - 这里复用现有的批处理入库逻辑（processPriceTableInternal），以保持行为一致
 * - 任何失败都以 ok=false 返回，不抛出异常，避免影响调用方主流程
 */
export async function syncCloudPriceTableToDatabase(
  overwriteManual?: string[]
): Promise<CloudPriceTableResult<PriceUpdateResult>> {
  const tomlResult = await fetchCloudPriceTableToml();
  if (!tomlResult.ok) {
    return tomlResult;
  }

  const parseResult = parseCloudPriceTableToml(tomlResult.data);
  if (!parseResult.ok) {
    return { ok: false, error: parseResult.error };
  }

  try {
    const { processPriceTableInternal } = await import("@/actions/model-prices");
    const jsonContent = JSON.stringify(parseResult.data.models);
    const result = await processPriceTableInternal(jsonContent, overwriteManual);

    if (!result.ok) {
      return { ok: false, error: result.error ?? "云端价格表写入失败" };
    }
    if (!result.data) {
      return { ok: false, error: "云端价格表写入失败：返回结果为空" };
    }

    return { ok: true, data: result.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `云端价格表写入失败：${message}` };
  }
}

const DEFAULT_THROTTLE_MS = 5 * 60 * 1000;

/**
 * 请求一次云端价格表同步（异步执行，自动去重与节流）。
 *
 * 适用场景：
 * - 请求命中“未知模型/无价格”时触发异步同步，保证后续请求可命中价格
 */
export function requestCloudPriceTableSync(options: {
  reason: "missing-model" | "scheduled" | "manual";
  throttleMs?: number;
}): void {
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const taskId = "cloud-price-table-sync";

  // 去重：已有任务在跑则不重复触发
  const active = AsyncTaskManager.getActiveTasks();
  if (active.some((t) => t.taskId === taskId)) {
    return;
  }

  // 节流：避免短时间内频繁拉取云端价格表
  const g = globalThis as unknown as { __CCH_CLOUD_PRICE_SYNC_LAST_AT__?: number };
  const lastAt = g.__CCH_CLOUD_PRICE_SYNC_LAST_AT__ ?? 0;
  const now = Date.now();
  if (now - lastAt < throttleMs) {
    return;
  }

  AsyncTaskManager.register(
    taskId,
    (async () => {
      try {
        const result = await syncCloudPriceTableToDatabase();
        if (!result.ok) {
          logger.warn("[PriceSync] Cloud price sync task failed", {
            reason: options.reason,
            error: result.error,
          });
          return;
        }

        logger.info("[PriceSync] Cloud price sync task completed", {
          reason: options.reason,
          added: result.data.added.length,
          updated: result.data.updated.length,
          skippedConflicts: result.data.skippedConflicts?.length ?? 0,
          total: result.data.total,
        });
      } finally {
        g.__CCH_CLOUD_PRICE_SYNC_LAST_AT__ = Date.now();
      }
    })(),
    "cloud_price_table_sync"
  );
}
