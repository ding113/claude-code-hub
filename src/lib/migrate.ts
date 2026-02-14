import "server-only";

import path from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { logger } from "@/lib/logger";

const MIGRATION_ADVISORY_LOCK_NAME = "claude-code-hub:migrations";

export async function withAdvisoryLock<T>(
  lockName: string,
  fn: () => Promise<T>,
  options?: { skipIfLocked?: boolean }
): Promise<{ ran: boolean; result?: T }> {
  if (!process.env.DSN) {
    logger.error("DSN environment variable is not set");
    process.exit(1);
  }

  const client = postgres(process.env.DSN, { max: 1 });
  let acquired = false;

  try {
    if (options?.skipIfLocked) {
      const [row] = await client`SELECT pg_try_advisory_lock(hashtext(${lockName})) as locked`;
      acquired = row?.locked === true;
      if (!acquired) {
        return { ran: false };
      }
    } else {
      await client`SELECT pg_advisory_lock(hashtext(${lockName}))`;
      acquired = true;
    }

    const result = await fn();
    return { ran: true, result };
  } finally {
    if (acquired) {
      try {
        await client`SELECT pg_advisory_unlock(hashtext(${lockName}))`;
      } catch (unlockError) {
        logger.error("Failed to release advisory lock", {
          lockName,
          error: unlockError instanceof Error ? unlockError.message : String(unlockError),
        });
      }
    }

    await client.end();
  }
}

async function ensureDrizzleMigrationsTableExists(
  client: ReturnType<typeof postgres>
): Promise<void> {
  await client`CREATE SCHEMA IF NOT EXISTS "drizzle"`;
  await client`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `;
}

async function repairDrizzleMigrationsCreatedAt(input: {
  client: ReturnType<typeof postgres>;
  migrationsFolder: string;
}): Promise<void> {
  const { client, migrationsFolder } = input;

  // drizzle-orm migrator 仅比较 `created_at(folderMillis)` 来决定是否执行迁移。
  // 若历史 journal 的 `when` 被修正（或曾出现非单调），旧实例可能会因为 `created_at` 偏大而永久跳过后续迁移。
  // 这里用 hash 对齐并修复 created_at，让升级对用户无感（Docker 拉新镜像重启即可）。
  const migrations = readMigrationFiles({ migrationsFolder });

  const expectedCreatedAtByHash = new Map<string, number>();
  for (const migration of migrations) {
    expectedCreatedAtByHash.set(migration.hash, migration.folderMillis);
  }

  const rows = (await client`
    SELECT id, hash, created_at
    FROM "drizzle"."__drizzle_migrations"
  `) as Array<{
    id: number;
    hash: string;
    created_at: string | number | null;
  }>;

  const pendingFixes: Array<{ id: number; hash: string; from: number | null; to: number }> = [];

  for (const row of rows) {
    const expected = expectedCreatedAtByHash.get(row.hash);
    if (expected == null) {
      continue;
    }

    const currentRaw = row.created_at;
    const current =
      typeof currentRaw === "number"
        ? currentRaw
        : typeof currentRaw === "string"
          ? Number(currentRaw)
          : null;

    if (current == null || !Number.isFinite(current) || current !== expected) {
      pendingFixes.push({
        id: row.id,
        hash: row.hash,
        from: current,
        to: expected,
      });
    }
  }

  if (pendingFixes.length === 0) {
    return;
  }

  for (const fix of pendingFixes) {
    await client`
      UPDATE "drizzle"."__drizzle_migrations"
      SET created_at = ${fix.to}
      WHERE id = ${fix.id}
    `;
  }

  logger.info("Repaired drizzle.__drizzle_migrations created_at", {
    repaired: pendingFixes.length,
  });
}

/**
 * 自动执行数据库迁移
 * 在生产环境启动时自动运行
 */
export async function runMigrations() {
  if (!process.env.DSN) {
    logger.error("DSN environment variable is not set");
    process.exit(1);
  }

  logger.info("Starting database migrations...");

  const migrationClient = postgres(process.env.DSN, { max: 1 });
  const db = drizzle(migrationClient);

  try {
    logger.info("Waiting for database migration lock...");
    await migrationClient`SELECT pg_advisory_lock(hashtext(${MIGRATION_ADVISORY_LOCK_NAME}))`;
    logger.info("Database migration lock acquired");

    // 获取迁移文件路径
    const migrationsFolder = path.join(process.cwd(), "drizzle");

    await ensureDrizzleMigrationsTableExists(migrationClient);
    await repairDrizzleMigrationsCreatedAt({ client: migrationClient, migrationsFolder });

    // 执行迁移
    await migrate(db, { migrationsFolder });

    logger.info("Database migrations completed successfully");
  } catch (error) {
    logger.error("Migration failed", error);
    process.exit(1);
  } finally {
    try {
      await migrationClient`SELECT pg_advisory_unlock(hashtext(${MIGRATION_ADVISORY_LOCK_NAME}))`;
    } catch (unlockError) {
      logger.error("Failed to release database migration lock", unlockError);
    }

    // 关闭连接
    await migrationClient.end();
  }
}

/**
 * 检查数据库连接
 */
export async function checkDatabaseConnection(retries = 30, delay = 2000): Promise<boolean> {
  if (!process.env.DSN) {
    logger.error("DSN environment variable is not set");
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
      logger.error(`Waiting for database... (${i + 1}/${retries})`, error);
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  logger.error("Failed to connect to database after retries", { attempts: retries });
  return false;
}
