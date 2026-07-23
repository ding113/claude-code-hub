/**
 * Next.js Instrumentation Hook
 * 在服务器启动时自动执行数据库迁移
 */

import { findSafeDatabaseError } from "@/drizzle/admitted-client";
import { startCacheCleanup } from "@/lib/cache/session-cache";
import { getBenignBrokenPipeCode } from "@/lib/lifecycle/benign-errors";
import { logger } from "@/lib/logger";
import { CHANNEL_API_KEYS_UPDATED, subscribeCacheInvalidation } from "@/lib/redis/pubsub";
import { apiKeyVacuumFilter } from "@/lib/security/api-key-vacuum-filter";

// instrumentation 需要 Node.js runtime（依赖数据库与 Redis 等 Node 能力）
export const runtime = "nodejs";

const instrumentationState = globalThis as unknown as {
  __CCH_CACHE_CLEANUP_STARTED__?: boolean;
  __CCH_SHUTDOWN_HOOKS_REGISTERED__?: boolean;
  __CCH_SHUTDOWN_IN_PROGRESS__?: boolean;
  __CCH_CLOUD_PRICE_SYNC_STARTED__?: boolean;
  __CCH_CLOUD_PRICE_SYNC_INTERVAL_ID__?: ReturnType<typeof setInterval>;
  __CCH_CACHE_EFFECTIVENESS_STARTED__?: boolean;
  __CCH_CACHE_EFFECTIVENESS_INTERVAL_ID__?: ReturnType<typeof setInterval>;
  __CCH_REPLAY_CLEANUP_STARTED__?: boolean;
  __CCH_REPLAY_CLEANUP_INTERVAL_ID__?: ReturnType<typeof setInterval>;
  __CCH_API_KEY_VF_SYNC_STARTED__?: boolean;
  __CCH_API_KEY_VF_SYNC_CLEANUP__?: (() => void) | null;
  __CCH_LIFECYCLE_MARKERS_LOGGED__?: boolean;
  __CCH_CRASH_HANDLERS_REGISTERED__?: boolean;
  __CCH_PROCESS_STARTED_AT__?: number;
};

/**
 * 进程级崩溃诊断
 *
 * 背景：生产环境曾出现 exitCode=139 (SIGSEGV) 重启（issue #1147），但日志中
 * 未捕获到任何 JS 异常。本函数注册 uncaughtException / unhandledRejection 兜底
 * 处理器，并在崩溃时尝试写入 Node 诊断报告（report.*.json）。
 *
 * 必要的 node 启动参数（在 Dockerfile 中配置）：
 *   --report-on-fatalerror --report-uncaught-exception --report-exclude-env
 *   --report-directory=/app/reports
 *
 * 这两个 process.on(...) 不会与现有的 SIGTERM / SIGINT 处理器冲突。
 */
export function registerCrashDiagnostics(): void {
  if (instrumentationState.__CCH_CRASH_HANDLERS_REGISTERED__) {
    return;
  }
  instrumentationState.__CCH_CRASH_HANDLERS_REGISTERED__ = true;

  const toSafeCrashError = (error: unknown): Error => {
    const databaseError = findSafeDatabaseError(error);
    if (databaseError) return new Error(databaseError.message);
    return error instanceof Error ? error : new Error(String(error));
  };

  const writeReport = (trigger: string, err: unknown): string | undefined => {
    try {
      const report = (
        process as NodeJS.Process & {
          report?: {
            excludeEnv?: boolean;
            writeReport: (filename?: string, err?: unknown) => string;
          };
        }
      ).report;
      if (report?.writeReport) {
        // Diagnostic reports are durable artifacts. Exclude the entire
        // environment rather than maintaining an incomplete secret allowlist.
        report.excludeEnv = true;
        return report.writeReport(`report.${trigger}.${Date.now()}.json`, toSafeCrashError(err));
      }
    } catch {
      // 写入诊断报告失败不应再抛出
    }
    return undefined;
  };

  // pino 在生产环境是同步直写 stdout（无 transport），但 dev 用 pino-pretty
  // worker 是异步的；fatal 路径下 process.exit() 可能抢在 worker 写出之前。
  // 用一行 JSON 直接同步写 stderr 作为兜底，确保至少日志层面留下痕迹。
  const writeFatalStderr = (trigger: string, err: Error, reportPath?: string): void => {
    try {
      const line = JSON.stringify({
        time: new Date().toISOString(),
        level: "fatal",
        msg: `[Lifecycle] ${trigger}`,
        pid: process.pid,
        error: err.message,
        errorName: err.name,
        stack: err.stack,
        reportPath,
      });
      process.stderr.write(`${line}\n`);
    } catch {
      // ignore: 兜底写失败时已无更上游
    }
  };

  process.on("uncaughtException", (err: Error) => {
    // 良性断管（EPIPE，issue #1234）：流式响应写入由 Next.js 持有，下游断开会让 socket
    // write 在本地 try/catch 之外抛 EPIPE 并逃逸到此。这是请求级传输关闭，不应放大为整个
    // 进程退出/容器重启。仅抑制写侧、来源明确的 EPIPE；ECONNRESET 等来源不明的码仍 fail-fast。
    const benignCode = getBenignBrokenPipeCode(err);
    if (benignCode) {
      logger.warn("[Lifecycle] ignored uncaught client disconnect", {
        error: err.message,
        errorName: err.name,
        errorCode: benignCode,
        stack: err.stack,
      });
      return;
    }

    const safeError = toSafeCrashError(err);
    const reportPath = writeReport("uncaughtException", safeError);
    writeFatalStderr("uncaughtException", safeError, reportPath);
    logger.fatal("[Lifecycle] uncaughtException", {
      error: safeError.message,
      errorName: safeError.name,
      stack: safeError.stack,
      reportPath,
    });
    // 与 Node 默认行为一致：捕获后退出，避免后续运行在不一致状态
    process.exit(1);
  });

  // Node 20 默认 --unhandled-rejections=throw：未注册处理器时直接 fail-fast。
  // 注册了处理器就会变成 "继续运行"，相当于回归到旧行为。我们仍要求 fail-fast，
  // 否则一个未捕获的 promise 会让进程留在未定义状态、绕过 supervisor 重启。
  // 因此：写诊断报告 + 同步落盘日志 + 主动 exit(1) 复现默认语义。
  process.on("unhandledRejection", (reason: unknown) => {
    // 同 uncaughtException：良性断管（EPIPE）以 rejection 形式逃逸时同样不应使进程退出。
    // 对原始 reason 判定（而非 wrap 后的 err），否则 { code: "EPIPE" } 之类非 Error 拒因在
    // new Error(String(reason)) 后会丢失 code，且 message 会变成 "[object Object]"。
    const benignCode = getBenignBrokenPipeCode(reason);
    if (benignCode) {
      logger.warn("[Lifecycle] ignored unhandled client disconnect", {
        error: reason instanceof Error ? reason.message : `non-Error rejection (${benignCode})`,
        errorName: reason instanceof Error ? reason.name : typeof reason,
        errorCode: benignCode,
        stack: reason instanceof Error ? reason.stack : undefined,
      });
      return;
    }

    const err = toSafeCrashError(reason);
    const reportPath = writeReport("unhandledRejection", err);
    writeFatalStderr("unhandledRejection", err, reportPath);
    logger.fatal("[Lifecycle] unhandledRejection", {
      error: err.message,
      errorName: err.name,
      stack: err.stack,
      reportPath,
    });
    process.exit(1);
  });
}

function logStartupMarker(): void {
  if (instrumentationState.__CCH_LIFECYCLE_MARKERS_LOGGED__) {
    return;
  }
  instrumentationState.__CCH_LIFECYCLE_MARKERS_LOGGED__ = true;
  instrumentationState.__CCH_PROCESS_STARTED_AT__ = Date.now();
  logger.info("[Lifecycle] Process started", {
    pid: process.pid,
    nodeVersion: process.version,
    execArgv: process.execArgv,
    nodeOptions: process.env.NODE_OPTIONS ?? null,
  });
}

/**
 * 同步错误规则并初始化检测器
 * 提取为独立函数以避免代码重复
 *
 * 每次启动都会同步 DEFAULT_ERROR_RULES 到数据库，采用"用户自定义优先"策略：
 * - pattern 不存在：插入新规则
 * - pattern 存在且 isDefault=true：更新为最新默认规则
 * - pattern 存在且 isDefault=false：跳过（保留用户的自定义版本）
 *
 * 注意: 此函数会传播关键错误,调用者应决定是否需要优雅降级
 */
async function syncErrorRulesAndInitializeDetector(): Promise<void> {
  // 同步默认错误规则到数据库 - 每次启动都完整同步
  const { syncDefaultErrorRules } = await import("@/repository/error-rules");
  const syncResult = await syncDefaultErrorRules();
  logger.info(
    `Default error rules synced: ${syncResult.inserted} inserted, ${syncResult.updated} updated, ${syncResult.skipped} skipped, ${syncResult.deleted} deleted`
  );

  // 加载错误规则缓存 - 让关键错误传播
  const { errorRuleDetector } = await import("@/lib/error-rule-detector");
  await errorRuleDetector.reload();
  logger.info("Error rule detector cache loaded successfully");
}

/**
 * 启动云端价格表定时同步（每 30 分钟一次）。
 *
 * 约束：
 * - 使用 globalThis 状态去重，避免开发环境热重载重复注册
 * - 失败不阻塞启动，仅记录日志
 */
async function startCloudPriceSyncScheduler(): Promise<void> {
  if (instrumentationState.__CCH_CLOUD_PRICE_SYNC_STARTED__) {
    return;
  }

  try {
    const { requestCloudPriceTableSync } = await import("@/lib/price-sync/cloud-price-updater");
    const intervalMs = 30 * 60 * 1000;

    // 启动后立即触发一次（避免首次 30 分钟空窗期）
    requestCloudPriceTableSync({ reason: "scheduled", throttleMs: 0 });

    instrumentationState.__CCH_CLOUD_PRICE_SYNC_INTERVAL_ID__ = setInterval(() => {
      try {
        requestCloudPriceTableSync({ reason: "scheduled", throttleMs: 0 });
      } catch (error) {
        logger.warn("[Instrumentation] Cloud price sync scheduler tick failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, intervalMs);

    instrumentationState.__CCH_CLOUD_PRICE_SYNC_STARTED__ = true;
    logger.info("[Instrumentation] Cloud price sync scheduler started", {
      intervalSeconds: intervalMs / 1000,
    });
  } catch (error) {
    logger.warn("[Instrumentation] Cloud price sync scheduler init failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * F3b：缓存效果窗口聚合定时任务（每 5 分钟，ENABLE_CACHE_EFFECTIVENESS 开启时）。
 * 服务内部有 advisory lock 防多副本重复跑；tick 失败仅记日志。
 */
async function startCacheEffectivenessScheduler(): Promise<void> {
  if (instrumentationState.__CCH_CACHE_EFFECTIVENESS_STARTED__) {
    return;
  }

  try {
    const { getEnvConfig } = await import("@/lib/config/env.schema");
    if (!getEnvConfig().ENABLE_CACHE_EFFECTIVENESS) {
      return;
    }
    const { aggregateCacheEffectiveness } = await import("@/lib/cache-effectiveness/service");
    const intervalMs = 5 * 60 * 1000;

    instrumentationState.__CCH_CACHE_EFFECTIVENESS_INTERVAL_ID__ = setInterval(() => {
      void aggregateCacheEffectiveness().catch((error) => {
        logger.warn("[Instrumentation] Cache effectiveness aggregation tick failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, intervalMs);

    instrumentationState.__CCH_CACHE_EFFECTIVENESS_STARTED__ = true;
    logger.info("[Instrumentation] Cache effectiveness scheduler started", {
      intervalSeconds: intervalMs / 1000,
    });
  } catch (error) {
    logger.warn("[Instrumentation] Cache effectiveness scheduler init failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * F2：Replay PG 持久层过期行清理（每 10 分钟，ENABLE_REQUEST_REPLAY 开启时）。
 * 写入路径已有机会式扫尾，此任务兜底低流量期无写入的场景。
 */
async function startReplayCleanupScheduler(): Promise<void> {
  if (instrumentationState.__CCH_REPLAY_CLEANUP_STARTED__) {
    return;
  }

  try {
    const { getEnvConfig } = await import("@/lib/config/env.schema");
    if (!getEnvConfig().ENABLE_REQUEST_REPLAY) {
      return;
    }
    const { getReplayStore } = await import("@/app/v1/_lib/proxy/replay/replay-store");
    const intervalMs = 10 * 60 * 1000;

    instrumentationState.__CCH_REPLAY_CLEANUP_INTERVAL_ID__ = setInterval(() => {
      void getReplayStore()
        .cleanupExpired()
        .catch((error) => {
          logger.warn("[Instrumentation] Replay cleanup tick failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }, intervalMs);

    instrumentationState.__CCH_REPLAY_CLEANUP_STARTED__ = true;
    logger.info("[Instrumentation] Replay cleanup scheduler started", {
      intervalSeconds: intervalMs / 1000,
    });
  } catch (error) {
    logger.warn("[Instrumentation] Replay cleanup scheduler init failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 多实例：订阅 API Key 变更广播，触发本机 Vacuum Filter 失效并重建。
 *
 * 目标：
 * - 避免“本机 filter 漏包含新 key”导致的误拒绝
 * - 重建失败/Redis 未配置时自动降级（不阻塞启动）
 */
async function startApiKeyVacuumFilterSync(): Promise<void> {
  if (instrumentationState.__CCH_API_KEY_VF_SYNC_STARTED__) {
    return;
  }

  // 与 Redis client 的启用条件保持一致：未启用限流/未配置 Redis 时不尝试订阅，避免额外 warn 日志
  const rateLimitRaw = process.env.ENABLE_RATE_LIMIT?.trim();
  if (rateLimitRaw === "false" || rateLimitRaw === "0" || !process.env.REDIS_URL) {
    return;
  }

  try {
    const cleanup = await subscribeCacheInvalidation(CHANNEL_API_KEYS_UPDATED, () => {
      apiKeyVacuumFilter.invalidateAndReload({ reason: "api_keys_updated" });
    });

    if (!cleanup) {
      return;
    }

    instrumentationState.__CCH_API_KEY_VF_SYNC_STARTED__ = true;
    instrumentationState.__CCH_API_KEY_VF_SYNC_CLEANUP__ = cleanup;
    logger.info("[Instrumentation] API Key Vacuum Filter sync enabled");
  } catch (error) {
    logger.warn("[Instrumentation] API Key Vacuum Filter sync init failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function warmupApiKeyVacuumFilter(): void {
  // 预热 API Key Vacuum Filter（减少无效 key 对 DB 的压力）
  try {
    apiKeyVacuumFilter.startBackgroundReload({ reason: "startup" });
  } catch (error) {
    logger.warn("[Instrumentation] Failed to start API key vacuum filter preload", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 多实例：订阅 key 变更广播以触发本机 filter 重建
  void startApiKeyVacuumFilterSync();
}

export async function register() {
  // 仅在服务器端执行
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 生命周期与崩溃诊断（issue #1147）
    // - startup marker：让运维能从日志中区分 "正常启动" 与 "Docker 异常重启后立即恢复"
    // - crash handlers：兜底 uncaughtException / unhandledRejection，并触发 Node 诊断报告
    logStartupMarker();
    registerCrashDiagnostics();

    // Initialize Langfuse observability (no-op if env vars not set)
    try {
      const { initLangfuse } = await import("@/lib/langfuse");
      await initLangfuse();
    } catch (error) {
      logger.warn("[Instrumentation] Langfuse initialization failed (non-critical)", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Skip initialization in CI environment (no DB connection needed)
    if (process.env.CI === "true") {
      logger.warn(
        "[Instrumentation] CI environment detected: skipping DB migrations, price seeding and queue scheduling"
      );
      return;
    }

    if (!instrumentationState.__CCH_CACHE_CLEANUP_STARTED__) {
      startCacheCleanup(60);
      instrumentationState.__CCH_CACHE_CLEANUP_STARTED__ = true;
      logger.info("[Instrumentation] Session cache cleanup started", {
        intervalSeconds: 60,
      });
    }

    if (!instrumentationState.__CCH_SHUTDOWN_HOOKS_REGISTERED__) {
      instrumentationState.__CCH_SHUTDOWN_HOOKS_REGISTERED__ = true;
      // SIGTERM/SIGINT 注册移到 server.js，因为它持有 HTTP server 句柄、可以先
      // server.close() 再让 application cleanup 跑。这里只把 cleanup 函数集
      // 挂到 globalThis 让 server.js 桥接调用。
      const { bindLifecycleGlobals } = await import("@/lib/lifecycle/shutdown");
      bindLifecycleGlobals();
    }

    // 生产环境: 执行完整初始化(迁移 + 价格表 + 清理任务 + 通知任务)
    if (process.env.NODE_ENV === "production") {
      const { checkDatabaseConnection, runMigrations, withAdvisoryLock } = await import(
        "@/lib/migrate"
      );

      logger.info("Initializing Claude Code Hub");

      // 等待数据库连接
      const isConnected = await checkDatabaseConnection();
      if (!isConnected) {
        logger.error("Cannot start application without database connection");
        process.exit(1);
      }

      // 执行迁移（可通过 AUTO_MIGRATE=false 跳过）
      const autoMigrateRaw = process.env.AUTO_MIGRATE?.trim().toLowerCase();
      const autoMigrateDisabled =
        autoMigrateRaw === "false" ||
        autoMigrateRaw === "0" ||
        autoMigrateRaw === "no" ||
        autoMigrateRaw === "off";

      if (!autoMigrateDisabled) {
        await runMigrations();
      } else {
        logger.info("[Instrumentation] AUTO_MIGRATE disabled: skipping migrations", {
          value: process.env.AUTO_MIGRATE,
        });
      }

      // Ledger backfill: fire-and-forget after migration (non-blocking, idempotent)
      Promise.all([import("@/lib/async-task-manager"), import("@/lib/ledger-backfill")])
        .then(([{ AsyncTaskManager }, { backfillUsageLedger }]) => {
          AsyncTaskManager.register(
            "startup-ledger-backfill",
            async (signal) => {
              const result = await backfillUsageLedger(signal);
              logger.info("[Instrumentation] Ledger backfill complete", result);
            },
            { taskType: "startup-ledger-backfill", staleTimeoutMs: Number.POSITIVE_INFINITY }
          );
        })
        .catch((err) => {
          logger.warn("[Instrumentation] Ledger backfill failed (non-fatal)", {
            error: err instanceof Error ? err.message : String(err),
          });
        });

      warmupApiKeyVacuumFilter();

      // 回填 provider_vendors/provider_endpoints（幂等）
      // 多实例启动时仅允许一个实例执行，避免重复扫描/写入导致的启动抖动（#779/#781）。
      const backfillLockName = "claude-code-hub:backfill:providers";
      const backfill = await withAdvisoryLock(
        backfillLockName,
        async () => {
          // 回填 provider_vendors（按域名自动聚合旧 providers）
          try {
            const { backfillProviderVendorsFromProviders } = await import(
              "@/repository/provider-endpoints"
            );
            const vendorResult = await backfillProviderVendorsFromProviders();
            logger.info("[Instrumentation] Provider vendors backfill completed", {
              processed: vendorResult.processed,
              providersUpdated: vendorResult.providersUpdated,
              vendorsCreatedCount: vendorResult.vendorsCreated.size,
              skippedInvalidUrl: vendorResult.skippedInvalidUrl,
            });
          } catch (error) {
            logger.warn("[Instrumentation] Failed to backfill provider vendors", {
              error: error instanceof Error ? error.message : String(error),
            });
          }

          // 回填 provider_endpoints（从 providers.url/类型 生成端点池，幂等）
          try {
            const { backfillProviderEndpointsFromProviders } = await import(
              "@/repository/provider-endpoints"
            );
            const result = await backfillProviderEndpointsFromProviders();
            logger.info("[Instrumentation] Provider endpoints backfill completed", result);
          } catch (error) {
            logger.warn("[Instrumentation] Failed to backfill provider endpoints", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
        { skipIfLocked: true }
      );

      if (!backfill.ran) {
        logger.info("[Instrumentation] Provider backfill skipped (lock not acquired)", {
          lockName: backfillLockName,
        });
      }

      // 初始化价格表（如果数据库为空）
      const { ensurePriceTable } = await import("@/lib/price-sync/seed-initializer");
      await ensurePriceTable();

      // 启动云端价格表定时同步
      await startCloudPriceSyncScheduler();

      // 同步错误规则并初始化检测器（非关键功能,允许优雅降级）
      try {
        await syncErrorRulesAndInitializeDetector();
      } catch (error) {
        logger.error(
          "[Instrumentation] Non-critical: Error rule detector initialization failed",
          error
        );
        // 继续启动 - 错误检测不是核心功能的关键依赖
      }

      // 初始化日志清理任务队列（如果启用）
      const { scheduleAutoCleanup } = await import("@/lib/log-cleanup/cleanup-queue");
      await scheduleAutoCleanup();

      // 初始化通知任务队列（如果启用）
      const { scheduleNotifications } = await import("@/lib/notification/notification-queue");
      await scheduleNotifications();
      (
        globalThis as typeof globalThis & {
          __CCH_STOP_BACKGROUND_QUEUES__?: () => Promise<void>;
        }
      ).__CCH_STOP_BACKGROUND_QUEUES__ = async () => {
        const [{ stopCleanupQueue }, { stopNotificationQueue }] = await Promise.all([
          import("@/lib/log-cleanup/cleanup-queue"),
          import("@/lib/notification/notification-queue"),
        ]);
        const results = await Promise.allSettled([stopCleanupQueue(), stopNotificationQueue()]);
        const failures = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : []
        );
        if (failures.length > 0) {
          throw new AggregateError(failures, "Failed to stop background queues");
        }
      };

      // 初始化智能探测调度器（如果启用）
      const { startProbeScheduler, isSmartProbingEnabled } = await import(
        "@/lib/circuit-breaker-probe"
      );
      if (isSmartProbingEnabled()) {
        startProbeScheduler();
        logger.info("Smart probing scheduler started");
      }

      try {
        const { startEndpointProbeScheduler } = await import(
          "@/lib/provider-endpoints/probe-scheduler"
        );
        startEndpointProbeScheduler();
      } catch (error) {
        logger.warn("[Instrumentation] Failed to start endpoint probe scheduler", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        const { startPublicStatusRebuildScheduler } = await import("@/lib/public-status/scheduler");
        startPublicStatusRebuildScheduler();
      } catch (error) {
        logger.warn("[Instrumentation] Failed to start public status rebuild scheduler", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // 初始化端点熔断器（禁用时清理残留状态）
      try {
        const { initEndpointCircuitBreaker } = await import("@/lib/endpoint-circuit-breaker");
        await initEndpointCircuitBreaker();
      } catch (error) {
        logger.warn("[Instrumentation] Failed to initialize endpoint circuit breaker", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        const { startEndpointProbeLogCleanup } = await import(
          "@/lib/provider-endpoints/probe-log-cleanup"
        );
        startEndpointProbeLogCleanup();
      } catch (error) {
        logger.warn("[Instrumentation] Failed to start endpoint probe log cleanup", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await startCacheEffectivenessScheduler();
      await startReplayCleanupScheduler();

      // F1/F3a：预热代理运行时设置快照（stream gate / affinity 的同步读取路径）
      try {
        const { getProxyRuntimeSettings } = await import("@/lib/system-settings/proxy-runtime");
        void getProxyRuntimeSettings().catch((error) => {
          logger.warn("[Instrumentation] Proxy runtime settings warmup failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      } catch (error) {
        logger.warn("[Instrumentation] Proxy runtime settings warmup init failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      logger.info("Application ready");
    }
    // 开发环境: 执行迁移 + 初始化价格表（禁用 Bull Queue 避免 Turbopack 冲突）
    else if (process.env.NODE_ENV === "development") {
      logger.info("Development mode: running migrations and initializing price table");

      // 执行数据库迁移（修复：开发环境也需要迁移）
      const { checkDatabaseConnection, runMigrations } = await import("@/lib/migrate");
      const isConnected = await checkDatabaseConnection();
      if (isConnected) {
        await runMigrations();

        // Ledger backfill: fire-and-forget after migration (non-blocking, idempotent)
        Promise.all([import("@/lib/async-task-manager"), import("@/lib/ledger-backfill")])
          .then(([{ AsyncTaskManager }, { backfillUsageLedger }]) => {
            AsyncTaskManager.register(
              "startup-ledger-backfill",
              async (signal) => {
                const result = await backfillUsageLedger(signal);
                logger.info("[Instrumentation] Ledger backfill complete", result);
              },
              { taskType: "startup-ledger-backfill", staleTimeoutMs: Number.POSITIVE_INFINITY }
            );
          })
          .catch((err) => {
            logger.warn("[Instrumentation] Ledger backfill failed (non-fatal)", {
              error: err instanceof Error ? err.message : String(err),
            });
          });

        warmupApiKeyVacuumFilter();

        // 回填 provider_vendors（按域名自动聚合旧 providers）
        try {
          const { backfillProviderVendorsFromProviders } = await import(
            "@/repository/provider-endpoints"
          );
          const vendorResult = await backfillProviderVendorsFromProviders();
          logger.info("[Instrumentation] Provider vendors backfill completed", {
            processed: vendorResult.processed,
            providersUpdated: vendorResult.providersUpdated,
            vendorsCreatedCount: vendorResult.vendorsCreated.size,
            skippedInvalidUrl: vendorResult.skippedInvalidUrl,
          });
        } catch (error) {
          logger.warn("[Instrumentation] Failed to backfill provider vendors", {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // 回填 provider_endpoints（幂等；避免老数据缺少端点池）
        try {
          const { backfillProviderEndpointsFromProviders } = await import(
            "@/repository/provider-endpoints"
          );
          const result = await backfillProviderEndpointsFromProviders();
          logger.info("[Instrumentation] Provider endpoints backfill completed", result);
        } catch (error) {
          logger.warn("[Instrumentation] Failed to backfill provider endpoints", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        logger.warn("Database connection failed, skipping migrations");
      }

      // 初始化价格表（如果数据库为空）
      const { ensurePriceTable } = await import("@/lib/price-sync/seed-initializer");
      await ensurePriceTable();

      // 启动云端价格表定时同步（仅在数据库可用时启用，避免本地无 DB 时反复报错）
      if (isConnected) {
        await startCloudPriceSyncScheduler();
      }

      // 同步错误规则并初始化检测器（非关键功能,允许优雅降级）
      try {
        await syncErrorRulesAndInitializeDetector();
      } catch (error) {
        logger.error(
          "[Instrumentation] Non-critical: Error rule detector initialization failed",
          error
        );
        // 继续启动 - 错误检测不是核心功能的关键依赖
      }

      // NOTE: 开发环境禁用通知队列（Bull + Turbopack 不兼容）
      // 通知功能仅在生产环境可用，开发环境需要手动测试
      logger.warn(
        "Notification queue disabled in development mode due to Bull + Turbopack incompatibility. " +
          "Notification features are only available in production environment."
      );

      // 初始化智能探测调度器（开发环境也支持）
      const { startProbeScheduler, isSmartProbingEnabled } = await import(
        "@/lib/circuit-breaker-probe"
      );
      if (isSmartProbingEnabled()) {
        startProbeScheduler();
        logger.info("Smart probing scheduler started (development mode)");
      }

      if (isConnected) {
        try {
          const { startEndpointProbeScheduler } = await import(
            "@/lib/provider-endpoints/probe-scheduler"
          );
          startEndpointProbeScheduler();
        } catch (error) {
          logger.warn("[Instrumentation] Failed to start endpoint probe scheduler", {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        try {
          const { startPublicStatusRebuildScheduler } = await import(
            "@/lib/public-status/scheduler"
          );
          startPublicStatusRebuildScheduler();
        } catch (error) {
          logger.warn("[Instrumentation] Failed to start public status rebuild scheduler", {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // 初始化端点熔断器（禁用时清理残留状态）
        try {
          const { initEndpointCircuitBreaker } = await import("@/lib/endpoint-circuit-breaker");
          await initEndpointCircuitBreaker();
        } catch (error) {
          logger.warn("[Instrumentation] Failed to initialize endpoint circuit breaker", {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        try {
          const { startEndpointProbeLogCleanup } = await import(
            "@/lib/provider-endpoints/probe-log-cleanup"
          );
          startEndpointProbeLogCleanup();
        } catch (error) {
          logger.warn("[Instrumentation] Failed to start endpoint probe log cleanup", {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        await startCacheEffectivenessScheduler();
        await startReplayCleanupScheduler();

        // F1/F3a：预热代理运行时设置快照（stream gate / affinity 的同步读取路径）
        try {
          const { getProxyRuntimeSettings } = await import("@/lib/system-settings/proxy-runtime");
          void getProxyRuntimeSettings().catch((error) => {
            logger.warn("[Instrumentation] Proxy runtime settings warmup failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        } catch (error) {
          logger.warn("[Instrumentation] Proxy runtime settings warmup init failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        logger.warn(
          "[Instrumentation] Database unavailable: skipping endpoint probe scheduler and cleanup"
        );
      }

      logger.info("Development environment ready");
    }
  }
}
