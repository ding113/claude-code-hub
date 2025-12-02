import { getSession } from "@/lib/auth";
import { getLogLevel, type LogLevel, logger, setLogLevel } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/admin/log-level
 * 获取当前日志级别
 */
export async function GET() {
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return new Response("Unauthorized", { status: 401 });
  }

  return Response.json({
    level: getLogLevel(),
  });
}

/**
 * POST /api/admin/log-level
 * 设置新的日志级别
 *
 * Body: { level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' }
 */
export async function POST(req: Request) {
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { level } = await req.json();

    const validLevels: LogLevel[] = ["fatal", "error", "warn", "info", "debug", "trace"];
    if (!level || !validLevels.includes(level)) {
      return Response.json({ error: "无效的日志级别", validLevels }, { status: 400 });
    }

    setLogLevel(level as LogLevel);

    return Response.json({
      success: true,
      level,
    });
  } catch (error) {
    logger.error("设置日志级别失败", { error });
    return Response.json({ error: "设置失败" }, { status: 500 });
  }
}
