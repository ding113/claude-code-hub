import { getSession } from "@/lib/auth";
import { acquireBackupLock, releaseBackupLock } from "@/lib/database-backup/backup-lock";
import { checkDatabaseConnection, executePgDump } from "@/lib/database-backup/docker-executor";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * 导出数据库备份
 *
 * GET /api/admin/database/export?excludeLogs=true
 *
 * Query Parameters:
 *   - excludeLogs: 'true' | 'false' (是否排除日志数据，默认 false)
 *
 * 响应: application/octet-stream (pg_dump custom format)
 */
export async function GET(request: Request) {
  let lockId: string | null = null;

  try {
    // 1. 验证管理员权限
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      logger.warn({ action: "database_export_unauthorized" });
      return new Response("Unauthorized", { status: 401 });
    }

    // 2. 尝试获取分布式锁（防止并发操作）
    lockId = await acquireBackupLock("export");
    if (!lockId) {
      logger.warn({
        action: "database_export_lock_conflict",
        user: session.user.name,
      });
      return Response.json(
        {
          error: "其他管理员正在执行备份操作，请稍后重试",
          details: "为确保数据一致性，同一时间只能执行一个备份操作",
        },
        { status: 409 }
      );
    }

    // 3. 检查数据库连接
    const isAvailable = await checkDatabaseConnection();
    if (!isAvailable) {
      logger.error({
        action: "database_export_connection_unavailable",
      });
      return Response.json({ error: "数据库连接不可用，请检查数据库服务状态" }, { status: 503 });
    }

    // 4. 解析查询参数
    const url = new URL(request.url);
    const excludeLogs = url.searchParams.get("excludeLogs") === "true";

    // 5. 执行 pg_dump
    const stream = executePgDump(excludeLogs);

    // 6. 生成文件名（带时间戳和标记）
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const suffix = excludeLogs ? "_no-logs" : "";
    const filename = `backup_${timestamp}${suffix}.dump`;

    logger.info({
      action: "database_export_initiated",
      filename,
      excludeLogs,
      user: session.user.name,
    });

    // 7. 监听请求取消（用户关闭浏览器）
    request.signal.addEventListener("abort", () => {
      if (lockId) {
        releaseBackupLock(lockId, "export").catch((err) => {
          logger.error({
            action: "database_export_lock_release_error",
            lockId,
            reason: "request_aborted",
            error: err.message,
          });
        });
      }
    });

    // 8. 包装流以确保锁的释放
    const cleanupStream = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      flush() {
        // 流正常结束时释放锁
        if (lockId) {
          releaseBackupLock(lockId, "export").catch((err) => {
            logger.error({
              action: "database_export_lock_release_error",
              lockId,
              reason: "stream_completed",
              error: err.message,
            });
          });
        }
      },
    });

    // 9. 返回流式响应
    return new Response(stream.pipeThrough(cleanupStream), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    logger.error({
      action: "database_export_error",
      error: error instanceof Error ? error.message : String(error),
    });

    // 出错时释放锁
    if (lockId) {
      releaseBackupLock(lockId, "export").catch((err) => {
        logger.error({
          action: "database_export_lock_release_error",
          lockId,
          reason: "error",
          error: err.message,
        });
      });
    }

    return Response.json(
      {
        error: "导出数据库失败",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
