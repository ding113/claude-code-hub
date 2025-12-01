import { writeFile } from "node:fs/promises";
import { getSession } from "@/lib/auth";
import { acquireBackupLock, releaseBackupLock } from "@/lib/database-backup/backup-lock";
import { checkDatabaseConnection, executePgRestore } from "@/lib/database-backup/docker-executor";
import {
  cleanupTempFile,
  createCleanupCallback,
  generateTempFilePath,
  registerTempFile,
} from "@/lib/database-backup/temp-file-manager";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

// 文件大小限制（500MB）
const MAX_FILE_SIZE = 500 * 1024 * 1024;

/**
 * 导入数据库备份
 *
 * POST /api/admin/database/import
 *
 * Body: multipart/form-data
 *   - file: 备份文件 (.dump)
 *   - cleanFirst: 'true' | 'false' (是否清除现有数据)
 *   - skipLogs: 'true' | 'false' (是否跳过日志数据导入)
 *
 * 响应: text/event-stream (SSE 格式的进度流)
 */
export async function POST(request: Request) {
  let tempFilePath: string | null = null;
  let lockId: string | null = null;

  try {
    // 1. 验证管理员权限
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      logger.warn({ action: "database_import_unauthorized" });
      return new Response("Unauthorized", { status: 401 });
    }

    // 2. 尝试获取分布式锁（防止并发操作）
    lockId = await acquireBackupLock("import");
    if (!lockId) {
      logger.warn({
        action: "database_import_lock_conflict",
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
        action: "database_import_connection_unavailable",
      });
      return Response.json({ error: "数据库连接不可用，请检查数据库服务状态" }, { status: 503 });
    }

    // 4. 解析表单数据
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const cleanFirst = formData.get("cleanFirst") === "true";
    const skipLogs = formData.get("skipLogs") === "true";

    if (!file) {
      return Response.json({ error: "缺少备份文件" }, { status: 400 });
    }

    // 5. 验证文件类型
    if (!file.name.endsWith(".dump")) {
      return Response.json({ error: "文件格式错误，仅支持 .dump 格式的备份文件" }, { status: 400 });
    }

    // 6. 验证文件大小
    if (file.size > MAX_FILE_SIZE) {
      logger.warn({
        action: "database_import_file_too_large",
        filename: file.name,
        fileSize: file.size,
        maxSize: MAX_FILE_SIZE,
      });
      return Response.json(
        {
          error: "文件过大，最大支持 500MB",
          details: `当前文件: ${(file.size / 1024 / 1024).toFixed(2)}MB，限制: 500MB`,
        },
        { status: 413 }
      );
    }

    logger.info({
      action: "database_import_initiated",
      filename: file.name,
      fileSize: file.size,
      cleanFirst,
      skipLogs,
      user: session.user.name,
    });

    // 7. 保存上传文件到临时目录
    tempFilePath = generateTempFilePath("import");
    const bytes = await file.arrayBuffer();
    await writeFile(tempFilePath, Buffer.from(bytes));

    // 注册临时文件（开始追踪）
    registerTempFile(tempFilePath, "import");

    logger.info({
      action: "database_import_file_saved",
      tempFilePath,
    });

    // 8. 监听请求取消（用户关闭浏览器）
    const abortCleanup = createCleanupCallback(tempFilePath, "aborted");
    request.signal.addEventListener("abort", abortCleanup);

    // 9. 执行 pg_restore，返回 SSE 流
    const stream = executePgRestore(tempFilePath, cleanFirst, skipLogs);

    // 10. 包装流以确保临时文件和锁的清理
    const cleanupStream = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      flush() {
        // 流正常结束时清理
        if (tempFilePath) {
          cleanupTempFile(tempFilePath, "completed").catch((err) => {
            logger.error({
              action: "database_import_cleanup_error",
              tempFilePath,
              error: err.message,
            });
          });
        }

        if (lockId) {
          releaseBackupLock(lockId, "import").catch((err) => {
            logger.error({
              action: "database_import_lock_release_error",
              lockId,
              error: err.message,
            });
          });
        }
      },
    });

    // 11. 返回 SSE 流式响应
    return new Response(stream.pipeThrough(cleanupStream), {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    logger.error({
      action: "database_import_error",
      error: error instanceof Error ? error.message : String(error),
    });

    // 出错时清理临时文件和锁
    if (tempFilePath) {
      cleanupTempFile(tempFilePath, "error").catch((err) => {
        logger.error({
          action: "database_import_cleanup_error",
          tempFilePath,
          error: err.message,
        });
      });
    }

    if (lockId) {
      releaseBackupLock(lockId, "import").catch((err) => {
        logger.error({
          action: "database_import_lock_release_error",
          lockId,
          error: err.message,
        });
      });
    }

    return Response.json(
      {
        error: "导入数据库失败",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
