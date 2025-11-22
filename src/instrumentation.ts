/**
 * Next.js Instrumentation Hook
 * 在服务器启动时自动执行数据库迁移
 */

import { logger } from "@/lib/logger";

/**
 * 初始化错误规则检测器
 * 提取为独立函数以避免代码重复
 */
async function initializeErrorRuleDetector(): Promise<void> {
  // 初始化默认错误规则
  const { initializeDefaultErrorRules } = await import("@/repository/error-rules");
  try {
    await initializeDefaultErrorRules();
    logger.info("Default error rules initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize default error rules:", error);
  }

  // 加载错误规则缓存（在数据库准备好后）
  const { errorRuleDetector } = await import("@/lib/error-rule-detector");
  try {
    await errorRuleDetector.reload();
    logger.info("Error rule detector cache loaded successfully");
  } catch (error) {
    logger.error("Failed to load error rule detector cache:", error);
  }
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

      // 初始化错误规则检测器
      await initializeErrorRuleDetector();

      // 初始化日志清理任务队列（如果启用）
      const { scheduleAutoCleanup } = await import("@/lib/log-cleanup/cleanup-queue");
      await scheduleAutoCleanup();

      // 初始化通知任务队列（如果启用）
      const { scheduleNotifications } = await import("@/lib/notification/notification-queue");
      await scheduleNotifications();

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

      // 初始化错误规则检测器
      await initializeErrorRuleDetector();

      // ⚠️ 开发环境禁用通知队列（Bull + Turbopack 不兼容）
      // 通知功能仅在生产环境可用，开发环境需要手动测试
      logger.warn(
        "Notification queue disabled in development mode due to Bull + Turbopack incompatibility. " +
          "Notification features are only available in production environment."
      );

      logger.info("Development environment ready");
    }
  }
}
