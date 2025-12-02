import { getSession } from "@/lib/auth";
import { getDatabaseConfig } from "@/lib/database-backup/db-config";
import { checkDatabaseConnection, getDatabaseInfo } from "@/lib/database-backup/docker-executor";
import { logger } from "@/lib/logger";
import type { DatabaseStatus } from "@/types/database-backup";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * 获取数据库状态信息
 *
 * GET /api/admin/database/status
 *
 * 响应: DatabaseStatus JSON
 */
export async function GET() {
  try {
    // 1. 验证管理员权限
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      logger.warn({ action: "database_status_unauthorized" });
      return new Response("Unauthorized", { status: 401 });
    }

    // 2. 获取数据库配置
    const dbConfig = getDatabaseConfig();

    // 3. 检查数据库连接
    const isAvailable = await checkDatabaseConnection();

    if (!isAvailable) {
      const status: DatabaseStatus = {
        isAvailable: false,
        containerName: `${dbConfig.host}:${dbConfig.port}`,
        databaseName: dbConfig.database,
        databaseSize: "N/A",
        tableCount: 0,
        postgresVersion: "N/A",
        error: "数据库连接不可用，请检查数据库服务状态",
      };

      logger.warn({
        action: "database_status_connection_unavailable",
        host: dbConfig.host,
        port: dbConfig.port,
      });

      return Response.json(status, { status: 200 });
    }

    // 4. 获取数据库详细信息
    try {
      const info = await getDatabaseInfo();

      const status: DatabaseStatus = {
        isAvailable: true,
        containerName: `${dbConfig.host}:${dbConfig.port}`,
        databaseName: dbConfig.database,
        databaseSize: info.size,
        tableCount: info.tableCount,
        postgresVersion: info.version,
      };

      logger.info({
        action: "database_status_retrieved",
        ...status,
      });

      return Response.json(status, { status: 200 });
    } catch (infoError) {
      const status: DatabaseStatus = {
        isAvailable: true,
        containerName: `${dbConfig.host}:${dbConfig.port}`,
        databaseName: dbConfig.database,
        databaseSize: "Unknown",
        tableCount: 0,
        postgresVersion: "Unknown",
        error: infoError instanceof Error ? infoError.message : String(infoError),
      };

      logger.error({
        action: "database_status_info_error",
        error: infoError instanceof Error ? infoError.message : String(infoError),
      });

      return Response.json(status, { status: 200 });
    }
  } catch (error) {
    logger.error({
      action: "database_status_error",
      error: error instanceof Error ? error.message : String(error),
    });

    return Response.json(
      {
        error: "获取数据库状态失败",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
