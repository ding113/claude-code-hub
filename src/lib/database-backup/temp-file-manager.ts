/**
 * 临时文件管理服务
 *
 * 解决临时文件泄漏问题，提供多重清理保障：
 * 1. 正常清理：操作完成后立即删除
 * 2. 异常清理：连接断开、进程崩溃时清理
 * 3. 定时清理：兜底机制，定期清理过期文件
 *
 * 设计原则：
 * - 明确的生命周期：创建 → 使用 → 清理
 * - 防御性编程：清理失败不影响主流程
 * - 可追踪：记录所有临时文件的创建和清理
 */

import { existsSync } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { logger } from "@/lib/logger";

export interface TempFileInfo {
  path: string;
  createdAt: number;
  purpose: "import" | "export";
}

// 内存追踪（用于故障恢复）
const activeTempFiles = new Map<string, TempFileInfo>();

/**
 * 生成临时文件路径
 *
 * @param purpose - 用途（import/export）
 * @returns 临时文件的绝对路径
 */
export function generateTempFilePath(purpose: "import" | "export"): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `/tmp/database_${purpose}_${timestamp}_${random}.dump`;
}

/**
 * 注册临时文件（开始追踪）
 *
 * @param filePath - 文件路径
 * @param purpose - 用途
 */
export function registerTempFile(filePath: string, purpose: "import" | "export"): void {
  activeTempFiles.set(filePath, {
    path: filePath,
    createdAt: Date.now(),
    purpose,
  });

  logger.info({
    action: "temp_file_registered",
    filePath,
    purpose,
    activeCount: activeTempFiles.size,
  });
}

/**
 * 清理临时文件（删除并取消追踪）
 *
 * @param filePath - 文件路径
 * @param reason - 清理原因（用于日志）
 */
export async function cleanupTempFile(
  filePath: string,
  reason: "completed" | "error" | "aborted" | "timeout"
): Promise<void> {
  try {
    // 1. 尝试删除文件
    if (existsSync(filePath)) {
      await unlink(filePath);
      logger.info({
        action: "temp_file_deleted",
        filePath,
        reason,
      });
    } else {
      logger.warn({
        action: "temp_file_not_found",
        filePath,
        reason,
      });
    }
  } catch (error) {
    // 清理失败不应影响主流程
    logger.error({
      action: "temp_file_cleanup_error",
      filePath,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // 2. 取消追踪（即使删除失败也要取消）
    const fileInfo = activeTempFiles.get(filePath);
    activeTempFiles.delete(filePath);

    if (fileInfo) {
      const lifetime = Date.now() - fileInfo.createdAt;
      logger.info({
        action: "temp_file_unregistered",
        filePath,
        reason,
        lifetime,
        activeCount: activeTempFiles.size,
      });
    }
  }
}

/**
 * 批量清理过期的临时文件（兜底机制）
 *
 * @param maxAge - 最大文件年龄（毫秒，默认 6 小时）
 * @returns 清理的文件数量
 */
export async function cleanupStaleTempFiles(maxAge: number = 6 * 60 * 60 * 1000): Promise<number> {
  const now = Date.now();
  let cleanedCount = 0;

  logger.info({
    action: "temp_file_stale_cleanup_start",
    activeCount: activeTempFiles.size,
    maxAge,
  });

  for (const [filePath, fileInfo] of activeTempFiles.entries()) {
    const age = now - fileInfo.createdAt;

    if (age > maxAge) {
      logger.warn({
        action: "temp_file_stale_detected",
        filePath,
        age,
        maxAge,
        purpose: fileInfo.purpose,
      });

      await cleanupTempFile(filePath, "timeout");
      cleanedCount++;
    }
  }

  logger.info({
    action: "temp_file_stale_cleanup_complete",
    cleanedCount,
    remainingCount: activeTempFiles.size,
  });

  return cleanedCount;
}

/**
 * 获取临时文件信息（用于监控）
 *
 * @param filePath - 文件路径
 * @returns 文件信息或 null
 */
export async function getTempFileInfo(
  filePath: string
): Promise<(TempFileInfo & { size: number; exists: boolean }) | null> {
  const tracked = activeTempFiles.get(filePath);
  if (!tracked) return null;

  try {
    const stats = await stat(filePath);
    return {
      ...tracked,
      size: stats.size,
      exists: true,
    };
  } catch {
    return {
      ...tracked,
      size: 0,
      exists: false,
    };
  }
}

/**
 * 获取所有活跃的临时文件（用于监控）
 */
export function getAllActiveTempFiles(): TempFileInfo[] {
  return Array.from(activeTempFiles.values());
}

/**
 * 创建清理回调（用于 ReadableStream.cancel 或 AbortController）
 *
 * @param filePath - 文件路径
 * @param reason - 清理原因
 * @returns 清理函数
 */
export function createCleanupCallback(filePath: string, reason: "aborted" | "error"): () => void {
  return () => {
    // 异步清理，不阻塞调用者
    cleanupTempFile(filePath, reason).catch((err) => {
      logger.error({
        action: "cleanup_callback_error",
        filePath,
        reason,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  };
}

/**
 * 启动定时清理任务（应在应用启动时调用一次）
 *
 * @param interval - 清理间隔（毫秒，默认 1 小时）
 * @param maxAge - 最大文件年龄（毫秒，默认 6 小时）
 * @returns 清理任务的 ID（可用于 clearInterval）
 */
export function startPeriodicCleanup(
  interval: number = 60 * 60 * 1000,
  maxAge: number = 6 * 60 * 60 * 1000
): NodeJS.Timeout {
  logger.info({
    action: "temp_file_periodic_cleanup_start",
    interval,
    maxAge,
  });

  const intervalId = setInterval(() => {
    cleanupStaleTempFiles(maxAge).catch((err) => {
      logger.error({
        action: "temp_file_periodic_cleanup_error",
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, interval);

  // 立即执行一次清理（清理之前遗留的文件）
  cleanupStaleTempFiles(maxAge).catch((err) => {
    logger.error({
      action: "temp_file_initial_cleanup_error",
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return intervalId;
}
