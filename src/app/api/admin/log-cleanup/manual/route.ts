import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { type CleanupConditions, cleanupLogs } from "@/lib/log-cleanup/service";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * 清理请求参数校验 schema
 */
const cleanupRequestSchema = z.object({
  beforeDate: z.string().optional(),
  afterDate: z.string().optional(),
  userIds: z.array(z.number()).optional(),
  providerIds: z.array(z.number()).optional(),
  statusCodes: z.array(z.number()).optional(),
  statusCodeRange: z
    .object({
      min: z.number(),
      max: z.number(),
    })
    .optional(),
  onlyBlocked: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

/**
 * 手动清理日志 API
 *
 * POST /api/admin/log-cleanup/manual
 *
 * Body: {
 *   beforeDate?: string;          // ISO 8601 日期字符串
 *   afterDate?: string;           // ISO 8601 日期字符串
 *   userIds?: number[];           // 用户 ID 列表
 *   providerIds?: number[];       // 供应商 ID 列表
 *   statusCodes?: number[];       // 状态码列表
 *   statusCodeRange?: { min: number; max: number };  // 状态码范围
 *   onlyBlocked?: boolean;        // 仅清理被拦截的请求
 *   dryRun?: boolean;             // 仅预览，不实际删除
 * }
 *
 * Response: {
 *   success: boolean;
 *   totalDeleted: number;
 *   batchCount: number;
 *   durationMs: number;
 *   error?: string;
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // 1. 验证管理员权限
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      logger.warn({ action: "log_cleanup_unauthorized" });
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. 解析请求参数
    const body = await request.json();
    const validated = cleanupRequestSchema.parse(body);

    // 3. 构建清理条件
    const conditions: CleanupConditions = {
      beforeDate: validated.beforeDate ? new Date(validated.beforeDate) : undefined,
      afterDate: validated.afterDate ? new Date(validated.afterDate) : undefined,
      userIds: validated.userIds,
      providerIds: validated.providerIds,
      statusCodes: validated.statusCodes,
      statusCodeRange: validated.statusCodeRange,
      onlyBlocked: validated.onlyBlocked,
    };

    logger.info({
      action: "manual_log_cleanup_initiated",
      user: session.user.name,
      conditions,
      dryRun: validated.dryRun,
    });

    // 4. 执行清理
    const result = await cleanupLogs(
      conditions,
      { dryRun: validated.dryRun },
      { type: "manual", user: session.user.name }
    );

    return Response.json({
      success: !result.error,
      totalDeleted: result.totalDeleted,
      batchCount: result.batchCount,
      durationMs: result.durationMs,
      error: result.error,
    });
  } catch (error) {
    logger.error({
      action: "manual_log_cleanup_error",
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: "请求参数格式错误",
          details: error.issues,
        },
        { status: 400 }
      );
    }

    return Response.json(
      {
        error: "清理日志失败",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
