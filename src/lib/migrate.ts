"use server";

import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { logger } from "@/lib/logger";

/**
 * 自动执行数据库迁移
 * 在生产环境启动时自动运行
 */
export async function runMigrations() {
  if (!process.env.DSN) {
    logger.error("❌ DSN environment variable is not set");
    process.exit(1);
  }

  logger.info("🔄 Starting database migrations...");

  const migrationClient = postgres(process.env.DSN, { max: 1 });
  const db = drizzle(migrationClient);

  try {
    // 获取迁移文件路径
    const migrationsFolder = path.join(process.cwd(), "drizzle");

    // 执行迁移
    await migrate(db, { migrationsFolder });

    logger.info("✅ Database migrations completed successfully!");
  } catch (error) {
    logger.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    // 关闭连接
    await migrationClient.end();
  }
}

/**
 * 检查数据库连接
 */
export async function checkDatabaseConnection(retries = 30, delay = 2000): Promise<boolean> {
  if (!process.env.DSN) {
    logger.error("❌ DSN environment variable is not set");
    return false;
  }

  for (let i = 0; i < retries; i++) {
    try {
      const client = postgres(process.env.DSN, { max: 1 });
      await client`SELECT 1`;
      await client.end();
      logger.info("Database connection established");
      return true;
    } catch (error) {
      logger.error("⏳ Waiting for database... (${i + 1}/${retries})", error);
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  logger.error("Failed to connect to database after retries", { attempts: retries });
  return false;
}
