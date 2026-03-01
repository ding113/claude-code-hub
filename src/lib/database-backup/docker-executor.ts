import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { logger } from "@/lib/logger";
import { getDatabaseConfig } from "./db-config";

export type ExportMode = "full" | "excludeLogs" | "ledgerOnly";

/**
 * Parse PG_COMPOSE_EXEC env var into a command array for docker compose exec.
 * Returns null when unset (direct mode -- pg tools must exist on the host PATH).
 */
export function getDockerComposeExec(): string[] | null {
  const cmd = process.env.PG_COMPOSE_EXEC;
  if (!cmd) return null;
  return cmd.split(/\s+/);
}

/**
 * Spawn a PostgreSQL CLI tool, routing through docker compose exec when
 * PG_COMPOSE_EXEC is set.
 */
export function spawnPgTool(
  command: string,
  args: string[],
  env: Record<string, string>,
  options?: { stdin?: boolean }
) {
  const composeExec = getDockerComposeExec();

  if (!composeExec) {
    return spawn(command, args, {
      env: { ...process.env, ...env },
    });
  }

  const execFlags = ["-T"];
  if (options?.stdin) execFlags.push("-i");
  if (env.PGPASSWORD) {
    execFlags.push("-e", `PGPASSWORD=${env.PGPASSWORD}`);
  }

  return spawn(
    composeExec[0],
    [...composeExec.slice(1), "exec", ...execFlags, "postgres", command, ...args],
    { env: { ...process.env } }
  );
}

/**
 * 执行 pg_dump 导出数据库
 *
 * @param mode 导出模式:
 *   - 'full': 完整备份（默认）
 *   - 'excludeLogs': 排除日志数据（保留表结构但不导出 message_request 数据）
 *   - 'ledgerOnly': 仅导出账单数据（完全排除 message_request 表的结构和数据）
 * @returns ReadableStream 数据流
 */
export function executePgDump(mode: ExportMode = "full"): ReadableStream<Uint8Array> {
  const dbConfig = getDatabaseConfig();

  const args = [
    "-h",
    dbConfig.host,
    "-p",
    dbConfig.port.toString(),
    "-U",
    dbConfig.user,
    "-d",
    dbConfig.database,
    "-Fc", // Custom format (compressed)
    "-v", // Verbose
  ];

  if (mode === "excludeLogs") {
    // 保留表结构但不导出数据
    args.push("--exclude-table-data=message_request");
  } else if (mode === "ledgerOnly") {
    // 完全排除 message_request 表（结构和数据）
    args.push("--exclude-table=message_request");
  }

  const pgProcess = spawnPgTool("pg_dump", args, {
    PGPASSWORD: dbConfig.password,
  });

  logger.info({
    action: "pg_dump_start",
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    mode,
  });

  return new ReadableStream({
    start(controller) {
      // 监听 stdout (数据输出)
      pgProcess.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });

      // 监听 stderr (日志输出)
      pgProcess.stderr.on("data", (chunk: Buffer) => {
        logger.info(`[pg_dump] ${chunk.toString().trim()}`);
      });

      // 进程结束
      pgProcess.on("close", (code: number | null) => {
        if (code === 0) {
          logger.info({
            action: "pg_dump_complete",
            database: dbConfig.database,
          });
          controller.close();
        } else {
          const error = `pg_dump 失败，退出代码: ${code}`;
          logger.error({
            action: "pg_dump_error",
            database: dbConfig.database,
            exitCode: code,
          });
          controller.error(new Error(error));
        }
      });

      // 进程错误
      pgProcess.on("error", (err: Error) => {
        logger.error({
          action: "pg_dump_spawn_error",
          error: err.message,
        });
        controller.error(err);
      });
    },

    cancel() {
      pgProcess.kill();
      logger.warn({
        action: "pg_dump_cancelled",
        database: dbConfig.database,
      });
    },
  });
}

/**
 * 执行 pg_restore 导入数据库
 *
 * @param filePath 备份文件路径
 * @param cleanFirst 是否清除现有数据
 * @returns ReadableStream SSE 格式的进度流
 */
/**
 * 分析 pg_restore 错误类型
 *
 * @param errors - 错误信息数组
 * @returns 错误分析结果
 */
function analyzeRestoreErrors(errors: string[]): {
  hasFatalErrors: boolean;
  ignorableCount: number;
  fatalCount: number;
  summary: string;
} {
  // 可忽略的错误模式（对象已存在、角色不存在）
  const ignorablePatterns = [
    /already exists/i,
    /multiple primary keys/i,
    /duplicate key value/i,
    /role .* does not exist/i, // 角色不存在（使用 --no-owner 时可忽略）
  ];

  // 致命错误模式
  const fatalPatterns = [
    /could not connect/i,
    /authentication failed/i,
    /permission denied/i,
    /database .* does not exist/i,
    /out of memory/i,
    /disk full/i,
  ];

  let ignorableCount = 0;
  let fatalCount = 0;
  const fatalErrors: string[] = [];

  for (const error of errors) {
    const isIgnorable = ignorablePatterns.some((pattern) => pattern.test(error));
    const isFatal = fatalPatterns.some((pattern) => pattern.test(error));

    if (isFatal) {
      fatalCount++;
      fatalErrors.push(error);
    } else if (isIgnorable) {
      ignorableCount++;
    } else {
      // 未知错误，保守处理为致命错误
      fatalCount++;
      fatalErrors.push(error);
    }
  }

  let summary = "";
  if (fatalCount > 0) {
    summary = `发现 ${fatalCount} 个致命错误`;
    if (fatalErrors.length > 0) {
      summary += `：${fatalErrors[0]}`;
    }
  } else if (ignorableCount > 0) {
    summary = `数据导入完成，跳过了 ${ignorableCount} 个已存在的对象`;
  }

  return {
    hasFatalErrors: fatalCount > 0,
    ignorableCount,
    fatalCount,
    summary,
  };
}

export function executePgRestore(
  filePath: string,
  cleanFirst: boolean,
  skipLogs = false
): ReadableStream<Uint8Array> {
  const dbConfig = getDatabaseConfig();

  const args = [
    "-h",
    dbConfig.host,
    "-p",
    dbConfig.port.toString(),
    "-U",
    dbConfig.user,
    "-d",
    dbConfig.database,
    "-v", // Verbose（输出详细进度）
  ];

  // 覆盖模式：清除现有数据
  if (cleanFirst) {
    args.push("--clean", "--if-exists", "--no-owner");
  }

  // 跳过日志数据导入（保留表结构但不导入 message_request 数据）
  if (skipLogs) {
    args.push("--exclude-table-data=message_request");
  }

  // In docker exec mode, the host file path is not visible inside the
  // container. pg_restore reads from stdin when no filename argument is
  // given, and custom format (-Fc) supports this.
  const isDockerExec = !!getDockerComposeExec();
  if (!isDockerExec) {
    args.push(filePath);
  }

  const pgProcess = spawnPgTool(
    "pg_restore",
    args,
    { PGPASSWORD: dbConfig.password },
    { stdin: isDockerExec }
  );

  if (isDockerExec) {
    const fileStream = createReadStream(filePath);
    fileStream.pipe(pgProcess.stdin!);
    fileStream.on("error", (err) => {
      logger.error({
        action: "pg_restore_file_read_error",
        error: err.message,
        filePath,
      });
      pgProcess.kill();
    });
  }

  logger.info({
    action: "pg_restore_start",
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    cleanFirst,
    skipLogs,
    filePath,
  });

  const encoder = new TextEncoder();
  const errorLines: string[] = []; // 收集所有错误信息

  return new ReadableStream({
    start(controller) {
      // 监听 stderr（pg_restore 的进度信息都输出到 stderr）
      pgProcess.stderr.on("data", (chunk: Buffer) => {
        const message = chunk.toString().trim();
        logger.info(`[pg_restore] ${message}`);

        // 收集错误信息用于后续分析
        if (message.toLowerCase().includes("error:")) {
          errorLines.push(message);
        }

        // 发送 SSE 格式的进度消息
        const sseMessage = `data: ${JSON.stringify({ type: "progress", message })}\n\n`;
        controller.enqueue(encoder.encode(sseMessage));
      });

      // 监听 stdout（一般为空，但为了完整性还是处理）
      pgProcess.stdout.on("data", (chunk: Buffer) => {
        const message = chunk.toString().trim();
        if (message) {
          logger.info(`[pg_restore stdout] ${message}`);
        }
      });

      // 进程结束
      pgProcess.on("close", async (code: number | null) => {
        // 智能错误分析
        const analysis = analyzeRestoreErrors(errorLines);

        // 判断是否需要执行迁移（成功或可忽略错误）
        const shouldRunMigrations =
          code === 0 || (code === 1 && !analysis.hasFatalErrors && analysis.ignorableCount > 0);

        if (code === 0) {
          logger.info({
            action: "pg_restore_complete",
            database: dbConfig.database,
          });

          const progressMessage = `data: ${JSON.stringify({
            type: "progress",
            message: "数据导入成功！",
          })}\n\n`;
          controller.enqueue(encoder.encode(progressMessage));
        } else if (code === 1 && !analysis.hasFatalErrors && analysis.ignorableCount > 0) {
          // 特殊处理：退出代码 1 但只有可忽略错误（对象已存在）
          logger.warn({
            action: "pg_restore_complete_with_warnings",
            database: dbConfig.database,
            exitCode: code,
            ignorableErrors: analysis.ignorableCount,
            analysis: analysis.summary,
          });

          const progressMessage = `data: ${JSON.stringify({
            type: "progress",
            message: analysis.summary,
          })}\n\n`;
          controller.enqueue(encoder.encode(progressMessage));
        } else {
          // 真正的失败
          logger.error({
            action: "pg_restore_error",
            database: dbConfig.database,
            exitCode: code,
            fatalErrors: analysis.fatalCount,
            analysis: analysis.summary,
          });

          const errorMessage = `data: ${JSON.stringify({
            type: "error",
            message: analysis.summary || `数据导入失败，退出代码: ${code}`,
            exitCode: code,
            errorCount: analysis.fatalCount || errorLines.length,
          })}\n\n`;
          controller.enqueue(encoder.encode(errorMessage));
          controller.close();
          return;
        }

        // 如果数据导入成功，自动执行数据库迁移
        if (shouldRunMigrations) {
          try {
            logger.info({
              action: "pg_restore_running_migrations",
              database: dbConfig.database,
            });

            const migrationsMessage = `data: ${JSON.stringify({
              type: "progress",
              message: "正在执行数据库迁移以同步 schema...",
            })}\n\n`;
            controller.enqueue(encoder.encode(migrationsMessage));

            // 动态导入迁移函数
            const { runMigrations } = await import("@/lib/migrate");
            await runMigrations();

            logger.info({
              action: "pg_restore_migrations_complete",
              database: dbConfig.database,
            });

            const migrationSuccessMessage = `data: ${JSON.stringify({
              type: "progress",
              message: "数据库迁移完成！",
            })}\n\n`;
            controller.enqueue(encoder.encode(migrationSuccessMessage));

            // 发送最终完成消息
            const completeMessage = `data: ${JSON.stringify({
              type: "complete",
              message: "数据导入和迁移全部完成！",
              exitCode: code,
              warningCount: analysis.ignorableCount || undefined,
            })}\n\n`;
            controller.enqueue(encoder.encode(completeMessage));
          } catch (migrationError) {
            logger.error({
              action: "pg_restore_migrations_error",
              database: dbConfig.database,
              error:
                migrationError instanceof Error ? migrationError.message : String(migrationError),
            });

            const errorMessage = `data: ${JSON.stringify({
              type: "error",
              message: `数据库迁移失败: ${
                migrationError instanceof Error ? migrationError.message : String(migrationError)
              }`,
            })}\n\n`;
            controller.enqueue(encoder.encode(errorMessage));
          }
        }

        controller.close();
      });

      // 进程错误
      pgProcess.on("error", (err: Error) => {
        logger.error({
          action: "pg_restore_spawn_error",
          error: err.message,
        });

        const errorMessage = `data: ${JSON.stringify({
          type: "error",
          message: `执行 pg_restore 失败: ${err.message}`,
        })}\n\n`;
        controller.enqueue(encoder.encode(errorMessage));
        controller.close();
      });
    },

    cancel() {
      pgProcess.kill();
      logger.warn({
        action: "pg_restore_cancelled",
        database: dbConfig.database,
      });
    },
  });
}

/**
 * 获取数据库信息
 */
export async function getDatabaseInfo(): Promise<{
  size: string;
  tableCount: number;
  version: string;
}> {
  const result = await db.execute(sql`
    SELECT
      pg_size_pretty(pg_database_size(current_database())) as size,
      (SELECT count(*) FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE') as table_count,
      version() as version
  `);
  const row = result[0];
  return {
    size: String(row?.size ?? "Unknown"),
    tableCount: Number(row?.table_count ?? 0),
    version: String(row?.version ?? "Unknown").split(" ")[0] || "Unknown",
  };
}

/**
 * 检查数据库连接是否可用
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}
