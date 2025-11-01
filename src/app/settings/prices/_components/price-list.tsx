"use client";

import { useState, useEffect } from "react";
import { Search, Package, DollarSign, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ModelPrice } from "@/types/model-price";
import { useDebounce } from "@/lib/hooks/use-debounce";

interface PriceListProps {
  initialPrices: ModelPrice[];
  initialTotal: number;
  initialPage: number;
  initialPageSize: number;
}

/**
 * 价格列表组件（支持分页）
 */
export function PriceList({
  initialPrices,
  initialTotal,
  initialPage,
  initialPageSize,
}: PriceListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [prices, setPrices] = useState<ModelPrice[]>(initialPrices);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [isLoading, setIsLoading] = useState(false);

  // 使用防抖，避免频繁请求
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  // 计算总页数
  const totalPages = Math.ceil(total / pageSize);

  // 从 URL 搜索参数中读取初始状态（仅在挂载时执行一次）
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const searchParam = urlParams.get("search");
    const pageParam = urlParams.get("page");
    const sizeParam = urlParams.get("size");

    if (searchParam) setSearchTerm(searchParam);
    if (pageParam) setPage(parseInt(pageParam, 10));
    if (sizeParam) setPageSize(parseInt(sizeParam, 10));
  }, []); // 空依赖数组，仅在挂载时执行一次

  // 更新 URL 搜索参数
  const updateURL = (newSearchTerm: string, newPage: number, newPageSize: number) => {
    const url = new URL(window.location.href);
    if (newSearchTerm) {
      url.searchParams.set("search", newSearchTerm);
    } else {
      url.searchParams.delete("search");
    }
    if (newPage > 1) {
      url.searchParams.set("page", newPage.toString());
    } else {
      url.searchParams.delete("page");
    }
    if (newPageSize !== 50) {
      url.searchParams.set("size", newPageSize.toString());
    } else {
      url.searchParams.delete("size");
    }
    window.history.replaceState({}, "", url.toString());
  };

  // 获取价格数据
  const fetchPrices = async (newPage: number, newPageSize: number, newSearchTerm: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/prices?page=${newPage}&pageSize=${newPageSize}&search=${encodeURIComponent(newSearchTerm)}`
      );
      const result = await response.json();

      if (result.ok) {
        setPrices(result.data.data);
        setTotal(result.data.total);
        setPage(result.data.page);
        setPageSize(result.data.pageSize);
      }
    } catch (error) {
      console.error("获取价格数据失败:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // 当防抖后的搜索词变化时，触发搜索（重置到第一页）
  useEffect(() => {
    // 跳过初始渲染（当 debouncedSearchTerm 等于初始 searchTerm 时）
    if (debouncedSearchTerm !== searchTerm) return;

    const newPage = 1; // 搜索时重置到第一页
    setPage(newPage);
    updateURL(debouncedSearchTerm, newPage, pageSize);
    fetchPrices(newPage, pageSize, debouncedSearchTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchTerm]); // 仅依赖 debouncedSearchTerm

  // 搜索输入处理（只更新状态，不触发请求）
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
  };

  // 页面大小变化处理
  const handlePageSizeChange = (newPageSize: number) => {
    const newPage = Math.max(1, Math.min(page, Math.ceil(total / newPageSize)));
    setPageSize(newPageSize);
    setPage(newPage);
    updateURL(debouncedSearchTerm, newPage, newPageSize);
    fetchPrices(newPage, newPageSize, debouncedSearchTerm);
  };

  // 页面跳转处理
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setPage(newPage);
    updateURL(debouncedSearchTerm, newPage, pageSize);
    fetchPrices(newPage, pageSize, debouncedSearchTerm);
  };

  // 移除客户端过滤逻辑（现在由后端处理）
  const filteredPrices = prices;

  /**
   * 格式化价格显示为每百万token的价格
   */
  const formatPrice = (value?: number): string => {
    if (!value) return "-";
    // 将每token的价格转换为每百万token的价格
    const pricePerMillion = value * 1000000;
    // 格式化为合适的小数位数
    if (pricePerMillion < 0.01) {
      return pricePerMillion.toFixed(4);
    } else if (pricePerMillion < 1) {
      return pricePerMillion.toFixed(3);
    } else if (pricePerMillion < 100) {
      return pricePerMillion.toFixed(2);
    } else {
      return pricePerMillion.toFixed(0);
    }
  };

  /**
   * 获取模型类型标签
   */
  const getModeLabel = (mode?: string) => {
    switch (mode) {
      case "chat":
        return <Badge variant="default">对话</Badge>;
      case "image_generation":
        return <Badge variant="secondary">图像生成</Badge>;
      case "completion":
        return <Badge variant="outline">补全</Badge>;
      default:
        return <Badge variant="outline">未知</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* 搜索和页面大小控制 */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索模型名称..."
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">每页显示:</span>
          <Select
            value={pageSize.toString()}
            onValueChange={(value) => handlePageSizeChange(parseInt(value, 10))}
          >
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="200">200</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 价格表格 */}
      <div className="border rounded-lg">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-48 whitespace-normal">模型名称</TableHead>
              <TableHead className="w-24">类型</TableHead>
              <TableHead className="w-32 whitespace-normal">提供商</TableHead>
              <TableHead className="w-32 text-right">输入价格 ($/M)</TableHead>
              <TableHead className="w-32 text-right">输出价格 ($/M)</TableHead>
              <TableHead className="w-32">更新时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-current"></div>
                    <span>加载中...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredPrices.length > 0 ? (
              filteredPrices.map((price) => (
                <TableRow key={price.id}>
                  <TableCell className="font-mono text-sm whitespace-normal break-words">
                    {price.modelName}
                  </TableCell>
                  <TableCell>{getModeLabel(price.priceData.mode)}</TableCell>
                  <TableCell className="whitespace-normal break-words">
                    {price.priceData.litellm_provider || "-"}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-right">
                    {price.priceData.mode === "image_generation" ? (
                      "-"
                    ) : (
                      <span className="text-muted-foreground">
                        ${formatPrice(price.priceData.input_cost_per_token)}/M
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-right">
                    {price.priceData.mode === "image_generation" ? (
                      <span className="text-muted-foreground">
                        ${formatPrice(price.priceData.output_cost_per_image)}/img
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        ${formatPrice(price.priceData.output_cost_per_token)}/M
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(price.createdAt).toLocaleDateString("zh-CN")}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    {searchTerm ? (
                      <>
                        <Search className="h-8 w-8 opacity-50" />
                        <p>未找到匹配的模型</p>
                      </>
                    ) : (
                      <>
                        <Package className="h-8 w-8 opacity-50" />
                        <p>暂无价格数据</p>
                        <p className="text-sm">系统已内置价格表，请通过上方按钮同步或更新</p>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* 分页控件 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            显示第 {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} 条，共 {total}{" "}
            条记录
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1 || isLoading}
            >
              <ChevronLeft className="h-4 w-4" />
              上一页
            </Button>

            <div className="flex items-center gap-1">
              {/* 页码显示逻辑 */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }

                return (
                  <Button
                    key={pageNum}
                    variant={page === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => handlePageChange(pageNum)}
                    disabled={isLoading}
                    className="w-8 h-8"
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages || isLoading}
            >
              下一页
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* 统计信息 */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div className="flex items-center gap-1">
          <DollarSign className="h-4 w-4" />
          <span>共 {total} 个模型价格</span>
          {searchTerm && (
            <span className="text-muted-foreground">（搜索结果：{filteredPrices.length} 个）</span>
          )}
        </div>
        <div>
          最后更新：
          {prices.length > 0
            ? new Date(
                Math.max(...prices.map((p) => new Date(p.createdAt).getTime()))
              ).toLocaleDateString("zh-CN")
            : "-"}
        </div>
      </div>
    </div>
  );
}
