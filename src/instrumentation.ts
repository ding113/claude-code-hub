/**
 * Next.js Instrumentation Hook
 * 在服务器启动时自动执行数据库迁移
 */

import { logger } from "@/lib/logger";

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

export async function register() {
  // 仅在服务器端执行
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Skip initialization in CI environment (no DB connection needed)
    if (process.env.CI === "true") {
      logger.warn(
        "[Instrumentation] CI environment detected: skipping DB migrations, price seeding and queue scheduling"
      );
      return;
    }

    // 生产环境: 执行完整初始化(迁移 + 价格表 + 清理任务 + 通知任务)
    if (process.env.NODE_ENV === "production" && process.env.AUTO_MIGRATE !== "false") {
      const { checkDatabaseConnection, runMigrations } = await import("@/lib/migrate");

      logger.info("Initializing Claude Code Hub");

      // 等待数据库连接
      const isConnected = await checkDatabaseConnection();
      if (!isConnected) {
        logger.error("Cannot start application without database connection");
        process.exit(1);
      }

      // 执行迁移
      await runMigrations();

      // 初始化价格表（如果数据库为空）
      const { ensurePriceTable } = await import("@/lib/price-sync/seed-initializer");
      await ensurePriceTable();

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

      // 初始化智能探测调度器（如果启用）
      const { startProbeScheduler, isSmartProbingEnabled } = await import(
        "@/lib/circuit-breaker-probe"
      );
      if (isSmartProbingEnabled()) {
        startProbeScheduler();
        logger.info("Smart probing scheduler started");
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
      } else {
        logger.warn("Database connection failed, skipping migrations");
      }

      // 初始化价格表（如果数据库为空）
      const { ensurePriceTable } = await import("@/lib/price-sync/seed-initializer");
      await ensurePriceTable();

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

      // ⚠️ 开发环境禁用通知队列（Bull + Turbopack 不兼容）
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

      logger.info("Development environment ready");
    }
  }
}
