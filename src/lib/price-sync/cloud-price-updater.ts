import { logger } from "@/lib/logger";
import type { PriceUpdateResult } from "@/types/model-price";
import { type CloudPriceTableResult, fetchAndParseCloudPriceTable } from "./cloud-price-table";
import { type ConvertedCptTable, convertCptTable } from "./cpt-convert";

/** 拉取并转换云端 CPT v1 价格表 */
export async function loadConvertedCloudPriceTable(): Promise<
  CloudPriceTableResult<ConvertedCptTable>
> {
  const parsed = await fetchAndParseCloudPriceTable();
  if (!parsed.ok) {
    return parsed;
  }
  try {
    return { ok: true, data: convertCptTable(parsed.data) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `云端价格表转换失败：${message}` };
  }
}

/**
 * 将转换后的云端价格表写入数据库(source='cloud',本地 manual 优先),
 * 并完成整表切换语义:
 * - 未列入覆盖列表的 manual 模型跳过(记入 skippedConflicts)
 * - 云端已下线的模型(不在本次表内的非 manual 行,含旧版 litellm 行)删除
 * - providers 字典 / vendor 汇总 / 版本指纹落入 cloud_pricing_catalog
 */
export async function applyConvertedCloudPriceTable(
  converted: ConvertedCptTable,
  overwriteManual?: string[]
): Promise<CloudPriceTableResult<PriceUpdateResult>> {
  try {
    const { processPriceTableInternal } = await import("@/actions/model-prices");
    const jsonContent = JSON.stringify(converted.models);
    const result = await processPriceTableInternal(jsonContent, overwriteManual, "cloud");

    if (!result.ok) {
      return { ok: false, error: result.error ?? "云端价格表写入失败" };
    }
    if (!result.data) {
      return { ok: false, error: "云端价格表写入失败：返回结果为空" };
    }

    // 整表切换:清理云端已不存在的非 manual 模型(含旧版价格表遗留行)
    try {
      const { deleteCloudPricesNotIn } = await import("@/repository/model-price");
      const removed = await deleteCloudPricesNotIn(Object.keys(converted.models));
      if (removed > 0) {
        logger.info("[PriceSync] Removed stale cloud price rows", { removed });
      }
    } catch (error) {
      logger.warn("[PriceSync] Failed to clean up stale cloud prices", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const { upsertCloudPricingCatalog } = await import("@/repository/cloud-pricing-catalog");
      await upsertCloudPricingCatalog({
        version: converted.version,
        currency: converted.currency,
        refreshedAt: converted.refreshedAt || null,
        providers: converted.providers,
        vendors: converted.vendors,
        modelCount: Object.keys(converted.models).length,
      });
    } catch (error) {
      logger.warn("[PriceSync] Failed to persist cloud pricing catalog", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { ok: true, data: result.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `云端价格表写入失败：${message}` };
  }
}

/**
 * 拉取云端价格表并写入数据库(不覆盖 manual,本地优先)。
 *
 * 说明:
 * - 版本指纹未变化且行数一致时跳过写库(表约 10MB/4000+ 模型,30 分钟一轮询)
 * - 任何失败都以 ok=false 返回,不抛出异常,避免影响调用方主流程
 */
export async function syncCloudPriceTableToDatabase(
  overwriteManual?: string[]
): Promise<CloudPriceTableResult<PriceUpdateResult>> {
  const loaded = await loadConvertedCloudPriceTable();
  if (!loaded.ok) {
    return loaded;
  }
  const converted = loaded.data;

  // 版本短路:指纹一致且数据库云端行数与上次写入一致时无需重放整表
  if (!overwriteManual?.length && converted.version) {
    try {
      const [{ getCloudPricingCatalog }, { countCloudModelPrices }] = await Promise.all([
        import("@/repository/cloud-pricing-catalog"),
        import("@/repository/model-price"),
      ]);
      const catalog = await getCloudPricingCatalog();
      if (catalog && catalog.version === converted.version) {
        const cloudCount = await countCloudModelPrices();
        if (cloudCount === catalog.modelCount) {
          const total = Object.keys(converted.models).length;
          logger.debug("[PriceSync] Cloud price table unchanged, skipping write", {
            version: converted.version,
            total,
          });
          return {
            ok: true,
            data: {
              added: [],
              updated: [],
              unchanged: Object.keys(converted.models),
              failed: [],
              total,
              skippedConflicts: [],
            },
          };
        }
      }
    } catch (error) {
      logger.debug("[PriceSync] Version short-circuit check failed, falling through", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return applyConvertedCloudPriceTable(converted, overwriteManual);
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
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const taskId = "cloud-price-table-sync";

  // 节流：避免短时间内频繁拉取云端价格表
  const g = globalThis as unknown as {
    __CCH_CLOUD_PRICE_SYNC_LAST_AT__?: number;
    __CCH_CLOUD_PRICE_SYNC_SCHEDULING__?: boolean;
  };
  const lastAt = g.__CCH_CLOUD_PRICE_SYNC_LAST_AT__ ?? 0;
  const now = Date.now();
  if (now - lastAt < throttleMs) {
    return;
  }

  // 避免并发请求在 AsyncTaskManager 加载前重复触发（例如多请求同时命中 missing-model）
  if (g.__CCH_CLOUD_PRICE_SYNC_SCHEDULING__) {
    return;
  }
  g.__CCH_CLOUD_PRICE_SYNC_SCHEDULING__ = true;

  void (async () => {
    try {
      const { AsyncTaskManager } = await import("@/lib/async-task-manager");

      // 去重：已有任务在跑则不重复触发
      const active = AsyncTaskManager.getActiveTasks();
      if (active.some((t) => t.taskId === taskId)) {
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
    } catch (error) {
      logger.warn("[PriceSync] Cloud price sync scheduling failed", {
        reason: options.reason,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      g.__CCH_CLOUD_PRICE_SYNC_SCHEDULING__ = false;
    }
  })();
}
