import { type NextRequest, NextResponse } from "next/server";
import { getModelPricesPaginated } from "@/actions/model-prices";
import { getSession } from "@/lib/auth";
import type { PaginationParams } from "@/repository/model-price";

/**
 * GET /api/prices
 *
 * 查询参数:
 * - page: 页码 (默认: 1)
 * - pageSize: 每页大小 (默认: 50)
 * - search: 搜索关键词 (可选)
 */
export async function GET(request: NextRequest) {
  try {
    // 权限检查：只有管理员可以访问价格数据
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ ok: false, error: "无权限访问此资源" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);

    // 解析查询参数
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || searchParams.get("size") || "50", 10);
    const search = searchParams.get("search") || "";

    // 参数验证
    if (page < 1) {
      return NextResponse.json({ ok: false, error: "页码必须大于0" }, { status: 400 });
    }

    if (pageSize < 1 || pageSize > 200) {
      return NextResponse.json({ ok: false, error: "每页大小必须在1-200之间" }, { status: 400 });
    }

    // 构建分页参数
    const paginationParams: PaginationParams = {
      page,
      pageSize,
      search: search || undefined, // 传递搜索关键词给后端
    };

    // 获取分页数据（搜索在 SQL 层面执行）
    const result = await getModelPricesPaginated(paginationParams);

    return NextResponse.json(result);
  } catch (error) {
    console.error("获取价格数据失败:", error);
    return NextResponse.json({ ok: false, error: "服务器内部错误" }, { status: 500 });
  }
}
