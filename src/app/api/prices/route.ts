import { NextRequest, NextResponse } from "next/server";
import { getModelPricesPaginated } from "@/actions/model-prices";
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
    const { searchParams } = new URL(request.url);

    // 解析查询参数
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || searchParams.get('size') || '50', 10);
    const search = searchParams.get('search') || '';

    // 参数验证
    if (page < 1) {
      return NextResponse.json(
        { ok: false, error: '页码必须大于0' },
        { status: 400 }
      );
    }

    if (pageSize < 1 || pageSize > 200) {
      return NextResponse.json(
        { ok: false, error: '每页大小必须在1-200之间' },
        { status: 400 }
      );
    }

    // 构建分页参数
    const paginationParams: PaginationParams = {
      page,
      pageSize,
    };

    // 获取分页数据
    const result = await getModelPricesPaginated(paginationParams);

    if (!result.ok) {
      return NextResponse.json(result, { status: 403 });
    }

    // 如果有搜索关键词，在前端进行过滤
    // 注意：这里我们返回所有数据，让前端处理搜索，因为后端搜索会使得分页变得复杂
    // 如果需要后端搜索，需要在 repository 层实现 SQL 查询过滤
    let filteredData = result.data!.data;
    if (search.trim()) {
      filteredData = filteredData.filter(price =>
        price.modelName.toLowerCase().includes(search.toLowerCase())
      );

      // 重新计算分页信息
      const filteredTotal = filteredData.length;
      const filteredTotalPages = Math.ceil(filteredTotal / pageSize);
      const filteredOffset = (page - 1) * pageSize;
      const paginatedData = filteredData.slice(filteredOffset, filteredOffset + pageSize);

      return NextResponse.json({
        ok: true,
        data: {
          data: paginatedData,
          total: filteredTotal,
          page,
          pageSize,
          totalPages: filteredTotalPages,
        },
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('获取价格数据失败:', error);
    return NextResponse.json(
      { ok: false, error: '服务器内部错误' },
      { status: 500 }
    );
  }
}