import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { validateKey, setAuthCookie } from "@/lib/auth";

// 需要数据库连接
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { key } = await request.json();

    if (!key) {
      return NextResponse.json({ error: "请输入 API Key" }, { status: 400 });
    }

    const session = await validateKey(key);
    if (!session) {
      return NextResponse.json({ error: "API Key 无效或已过期" }, { status: 401 });
    }

    // 设置认证 cookie
    await setAuthCookie(key);

    return NextResponse.json({
      ok: true,
      user: {
        id: session.user.id,
        name: session.user.name,
        description: session.user.description,
        role: session.user.role,
      },
    });
  } catch (error) {
    logger.error("Login error:", error);
    return NextResponse.json({ error: "登录失败，请稍后重试" }, { status: 500 });
  }
}
