/**
 * Next.js Instrumentation Hook
 * 在服务器启动时自动执行数据库迁移
 */

import { logger } from "@/lib/logger";

export async function register() {
  // 仅在服务器端执行
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 生产环境: 执行完整初始化(迁移 + 价格表 + 清理任务)
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

      // 初始化日志清理任务队列（如果启用）
      const { scheduleAutoCleanup } = await import("@/lib/log-cleanup/cleanup-queue");
      await scheduleAutoCleanup();

      logger.info("Application ready");
    }
    // 开发环境: 仅初始化价格表(不执行数据库迁移)
    else if (process.env.NODE_ENV === "development") {
      logger.info("Development mode: initializing price table if needed");

      // 初始化价格表（如果数据库为空）
      const { ensurePriceTable } = await import("@/lib/price-sync/seed-initializer");
      await ensurePriceTable();

      logger.info("Development environment ready");
    }
  }
}
