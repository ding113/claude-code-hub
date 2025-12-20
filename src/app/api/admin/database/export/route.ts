import { getSession } from "@/lib/auth";
import { acquireBackupLock, releaseBackupLock } from "@/lib/database-backup/backup-lock";
import { checkDatabaseConnection, executePgDump } from "@/lib/database-backup/docker-executor";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * 创建监控包装流，确保在所有场景下都释放锁
 *
 * 关键场景：
 * - 成功完成：通过 pull() 中的 done === true 释放锁
 * - 流错误：通过 pull() 中的 catch 释放锁
 * - 请求取消：通过 cancel() 释放锁
 *
 * @param stream - 原始流（来自 pg_dump）
 * @param lockId - 备份锁 ID
 * @returns 包装后的流
 */
function createMonitoredStream(
  stream: ReadableStream<Uint8Array>,
  lockId: string
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let released = false;
  let cancelled = false;

  const releaseLock = async (reason?: string) => {
    if (released || !lockId) return;
    released = true; // 同步设置，在任何 await 之前
    await releaseBackupLock(lockId, "export").catch((err) => {
      logger.error({
        action: "database_export_lock_release_error",
        lockId,
        reason,
        error: err.message,
      });
    });
  };

  return new ReadableStream({
    async pull(controller) {
      // 如果已取消，不再读取
      if (cancelled) {
        controller.close();
        return;
      }

      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          await releaseLock("stream_done");
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        await releaseLock("stream_error");
        reader.releaseLock();
        controller.error(error);
      }
    },
    async cancel() {
      cancelled = true;
      await releaseLock("request_cancelled");
      await reader.cancel().catch((err) => {
        logger.error({
          action: "database_export_reader_cancel_error",
          lockId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    },
  });
}

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
      // 数据库不可用时释放锁
      if (lockId) {
        await releaseBackupLock(lockId, "export").catch((err) => {
          logger.error({
            action: "database_export_lock_release_error",
            lockId,
            reason: "connection_unavailable",
            error: err.message,
          });
        });
      }
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

    // 7. 返回流式响应（使用监控包装器确保锁的释放）
    return new Response(createMonitoredStream(stream, lockId), {
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
