"use client";

import { Claude, Gemini, OpenAI } from "@lobehub/icons";
import {
  Braces,
  ChevronLeft,
  ChevronRight,
  Code2,
  Database,
  DollarSign,
  Eye,
  FileText,
  Monitor,
  MoreHorizontal,
  Package,
  Pencil,
  Search,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { copyToClipboard } from "@/lib/utils/clipboard";
import type { ModelPrice, ModelPriceSource } from "@/types/model-price";
import { DeleteModelDialog } from "./delete-model-dialog";
import { ModelPriceDrawer } from "./model-price-drawer";

interface PriceListProps {
  initialPrices: ModelPrice[];
  initialTotal: number;
  initialPage: number;
  initialPageSize: number;
  initialSearchTerm: string;
  initialSourceFilter: ModelPriceSource | "";
  initialLitellmProviderFilter: string;
}

/**
 * 价格列表组件（支持分页）
 */
export function PriceList({
  initialPrices,
  initialTotal,
  initialPage,
  initialPageSize,
  initialSearchTerm,
  initialSourceFilter,
  initialLitellmProviderFilter,
}: PriceListProps) {
  const t = useTranslations("settings.prices");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm);
  const [sourceFilter, setSourceFilter] = useState<ModelPriceSource | "">(initialSourceFilter);
  const [litellmProviderFilter, setLitellmProviderFilter] = useState(initialLitellmProviderFilter);
  const [prices, setPrices] = useState<ModelPrice[]>(initialPrices);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [isLoading, setIsLoading] = useState(false);

  // 使用防抖，避免频繁请求
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const lastDebouncedSearchTerm = useRef(debouncedSearchTerm);
  const pendingRefreshPage = useRef<number | null>(null);

  // 计算总页数
  const totalPages = Math.ceil(total / pageSize);

  // 更新 URL 搜索参数
  const updateURL = useCallback(
    (
      newSearchTerm: string,
      newPage: number,
      newPageSize: number,
      newSourceFilter: ModelPriceSource | "",
      newLitellmProviderFilter: string
    ) => {
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
        url.searchParams.set("pageSize", newPageSize.toString());
        url.searchParams.delete("size");
      } else {
        url.searchParams.delete("pageSize");
        url.searchParams.delete("size");
      }

      if (newSourceFilter) {
        url.searchParams.set("source", newSourceFilter);
      } else {
        url.searchParams.delete("source");
      }

      if (newLitellmProviderFilter) {
        url.searchParams.set("litellmProvider", newLitellmProviderFilter);
      } else {
        url.searchParams.delete("litellmProvider");
      }
      window.history.replaceState({}, "", url.toString());
    },
    []
  );

  // 获取价格数据
  const fetchPrices = useCallback(
    async (
      newPage: number,
      newPageSize: number,
      newSearchTerm: string,
      newSourceFilter: ModelPriceSource | "",
      newLitellmProviderFilter: string
    ) => {
      setIsLoading(true);
      try {
        const url = new URL("/api/prices", window.location.origin);
        url.searchParams.set("page", newPage.toString());
        url.searchParams.set("pageSize", newPageSize.toString());
        url.searchParams.set("search", newSearchTerm);

        if (newSourceFilter) {
          url.searchParams.set("source", newSourceFilter);
        }
        if (newLitellmProviderFilter) {
          url.searchParams.set("litellmProvider", newLitellmProviderFilter);
        }

        const response = await fetch(url.toString());
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
    },
    []
  );

  // 监听价格数据变化事件（由其他组件触发）
  useEffect(() => {
    const handlePriceUpdate = () => {
      const forcedPage = pendingRefreshPage.current;
      if (typeof forcedPage === "number") {
        pendingRefreshPage.current = null;
        fetchPrices(forcedPage, pageSize, debouncedSearchTerm, sourceFilter, litellmProviderFilter);
        return;
      }

      fetchPrices(page, pageSize, debouncedSearchTerm, sourceFilter, litellmProviderFilter);
    };

    window.addEventListener("price-data-updated", handlePriceUpdate);
    return () => window.removeEventListener("price-data-updated", handlePriceUpdate);
  }, [page, pageSize, debouncedSearchTerm, fetchPrices, sourceFilter, litellmProviderFilter]);

  // 当防抖后的搜索词变化时，触发搜索（重置到第一页）
  useEffect(() => {
    if (debouncedSearchTerm === lastDebouncedSearchTerm.current) {
      return;
    }
    lastDebouncedSearchTerm.current = debouncedSearchTerm;

    const newPage = 1; // 搜索时重置到第一页
    setPage(newPage);
    updateURL(debouncedSearchTerm, newPage, pageSize, sourceFilter, litellmProviderFilter);
    fetchPrices(newPage, pageSize, debouncedSearchTerm, sourceFilter, litellmProviderFilter);
  }, [debouncedSearchTerm, fetchPrices, litellmProviderFilter, pageSize, sourceFilter, updateURL]);

  // 搜索输入处理（只更新状态，不触发请求）
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
  };

  // 页面大小变化处理
  const handlePageSizeChange = (newPageSize: number) => {
    const newPage = Math.max(1, Math.min(page, Math.ceil(total / newPageSize)));
    setPageSize(newPageSize);
    setPage(newPage);
    updateURL(debouncedSearchTerm, newPage, newPageSize, sourceFilter, litellmProviderFilter);
    fetchPrices(newPage, newPageSize, debouncedSearchTerm, sourceFilter, litellmProviderFilter);
  };

  // 页面跳转处理
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setPage(newPage);
    updateURL(debouncedSearchTerm, newPage, pageSize, sourceFilter, litellmProviderFilter);
    fetchPrices(newPage, pageSize, debouncedSearchTerm, sourceFilter, litellmProviderFilter);
  };

  // 移除客户端过滤逻辑（现在由后端处理）
  const filteredPrices = prices;

  /**
   * 格式化价格显示为每百万token的价格
   */
  const formatPrice = (value?: number): string => {
    if (value === undefined || value === null) return "-";
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
   * 格式化标量价格（用于 /img、/req 等）
   */
  const formatScalarPrice = (value?: number): string => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return "-";
    }
    if (value < 0.01) return value.toFixed(4);
    if (value < 1) return value.toFixed(3);
    if (value < 100) return value.toFixed(2);
    return value.toFixed(0);
  };

  const formatPerMillionTokenPriceLabel = (value?: number): string => {
    const formatted = formatPrice(value);
    if (formatted === "-") return "-";
    return `$${formatted}/M`;
  };

  const formatPerImagePriceLabel = (value?: number): string => {
    const formatted = formatScalarPrice(value);
    if (formatted === "-") return "-";
    return `$${formatted}/img`;
  };

  const formatPerRequestPriceLabel = (value?: number): string => {
    const formatted = formatScalarPrice(value);
    if (formatted === "-") return "-";
    return `$${formatted}/req`;
  };

  const handleCopyModelId = useCallback(
    async (modelId: string) => {
      const ok = await copyToClipboard(modelId);
      if (ok) {
        toast.success(tCommon("copySuccess"));
        return;
      }
      toast.error(tCommon("copyFailed"));
    },
    [tCommon]
  );

  const capabilityItems: Array<{
    key:
      | "supports_assistant_prefill"
      | "supports_computer_use"
      | "supports_function_calling"
      | "supports_pdf_input"
      | "supports_prompt_caching"
      | "supports_reasoning"
      | "supports_response_schema"
      | "supports_tool_choice"
      | "supports_vision";
    icon: React.ComponentType<{ className?: string }>;
    label: string;
  }> = [
    { key: "supports_function_calling", icon: Code2, label: t("capabilities.functionCalling") },
    { key: "supports_tool_choice", icon: Terminal, label: t("capabilities.toolChoice") },
    { key: "supports_response_schema", icon: Braces, label: t("capabilities.responseSchema") },
    { key: "supports_prompt_caching", icon: Database, label: t("capabilities.promptCaching") },
    { key: "supports_vision", icon: Eye, label: t("capabilities.vision") },
    { key: "supports_pdf_input", icon: FileText, label: t("capabilities.pdfInput") },
    { key: "supports_reasoning", icon: Sparkles, label: t("capabilities.reasoning") },
    { key: "supports_computer_use", icon: Monitor, label: t("capabilities.computerUse") },
    { key: "supports_assistant_prefill", icon: Pencil, label: t("capabilities.assistantPrefill") },
  ];

  const applyFilters = useCallback(
    (next: { source: ModelPriceSource | ""; litellmProvider: string }) => {
      setSourceFilter(next.source);
      setLitellmProviderFilter(next.litellmProvider);

      const newPage = 1;
      setPage(newPage);
      updateURL(debouncedSearchTerm, newPage, pageSize, next.source, next.litellmProvider);
      fetchPrices(newPage, pageSize, debouncedSearchTerm, next.source, next.litellmProvider);
    },
    [debouncedSearchTerm, fetchPrices, pageSize, updateURL]
  );

  return (
    <div className="space-y-4">
      {/* 快捷筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={!sourceFilter && !litellmProviderFilter ? "default" : "outline"}
          size="sm"
          onClick={() => applyFilters({ source: "", litellmProvider: "" })}
        >
          {t("filters.all")}
        </Button>

        <Button
          type="button"
          variant={sourceFilter === "manual" ? "default" : "outline"}
          size="sm"
          onClick={() =>
            applyFilters({
              source: sourceFilter === "manual" ? "" : "manual",
              litellmProvider: "",
            })
          }
        >
          <Package className="h-4 w-4 mr-2" />
          {t("filters.local")}
        </Button>

        <Button
          type="button"
          variant={litellmProviderFilter === "anthropic" ? "default" : "outline"}
          size="sm"
          onClick={() =>
            applyFilters({
              source: "",
              litellmProvider: litellmProviderFilter === "anthropic" ? "" : "anthropic",
            })
          }
        >
          <Claude.Color className="h-4 w-4 mr-2" />
          {t("filters.anthropic")}
        </Button>

        <Button
          type="button"
          variant={litellmProviderFilter === "openai" ? "default" : "outline"}
          size="sm"
          onClick={() =>
            applyFilters({
              source: "",
              litellmProvider: litellmProviderFilter === "openai" ? "" : "openai",
            })
          }
        >
          <OpenAI className="h-4 w-4 mr-2" />
          {t("filters.openai")}
        </Button>

        <Button
          type="button"
          variant={litellmProviderFilter === "vertex_ai-language-models" ? "default" : "outline"}
          size="sm"
          onClick={() =>
            applyFilters({
              source: "",
              litellmProvider:
                litellmProviderFilter === "vertex_ai-language-models"
                  ? ""
                  : "vertex_ai-language-models",
            })
          }
        >
          <Gemini.Color className="h-4 w-4 mr-2" />
          {t("filters.vertex")}
        </Button>
      </div>

      {/* 搜索和页面大小控制 */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("pagination.perPageLabel")}</span>
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
              <TableHead className="w-72 whitespace-normal">{t("table.modelName")}</TableHead>
              <TableHead className="w-40 whitespace-normal">{t("table.capabilities")}</TableHead>
              <TableHead className="w-48 whitespace-normal text-right">
                {t("table.price")}
              </TableHead>
              <TableHead className="w-36 whitespace-normal text-right">
                {t("table.cacheReadPrice")}
              </TableHead>
              <TableHead className="w-44 whitespace-normal text-right">
                {t("table.cacheCreationPrice")}
              </TableHead>
              <TableHead className="w-32">{t("table.updatedAt")}</TableHead>
              <TableHead className="w-20">{t("table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-current"></div>
                    <span>{t("table.loading")}</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredPrices.length > 0 ? (
              filteredPrices.map((price) => (
                <TableRow key={price.id}>
                  <TableCell className="whitespace-normal break-words">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {price.priceData.display_name?.trim() || price.modelName}
                      </span>
                      {price.priceData.litellm_provider ? (
                        <Badge variant="secondary" className="font-mono text-xs">
                          {price.priceData.litellm_provider}
                        </Badge>
                      ) : null}
                      {price.source === "manual" && (
                        <Badge variant="outline">{t("badges.local")}</Badge>
                      )}
                    </div>
                    <div className="mt-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={t("table.copyModelId")}
                            className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            onClick={() => handleCopyModelId(price.modelName)}
                          >
                            {price.modelName}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent sideOffset={4}>{t("table.copyModelId")}</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {capabilityItems.map(({ key, icon: Icon, label }) => {
                        const enabled = price.priceData[key] === true;
                        const status = enabled
                          ? t("capabilities.statusSupported")
                          : t("capabilities.statusUnsupported");
                        const tooltipText = t("capabilities.tooltip", { label, status });
                        return (
                          <Tooltip key={key}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                aria-label={tooltipText}
                                className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                                  enabled
                                    ? "bg-primary/10 text-primary border-primary/20"
                                    : "bg-muted/30 text-muted-foreground/40 border-transparent"
                                }`}
                              >
                                <Icon className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent sideOffset={4}>{tooltipText}</TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-right">
                    <div className="space-y-1">
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-xs text-muted-foreground">
                          {t("table.priceInput")}
                        </span>
                        <span className="text-muted-foreground">
                          {price.priceData.mode === "image_generation"
                            ? "-"
                            : formatPerMillionTokenPriceLabel(price.priceData.input_cost_per_token)}
                        </span>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-xs text-muted-foreground">
                          {t("table.priceOutput")}
                        </span>
                        <span className="text-muted-foreground">
                          {price.priceData.mode === "image_generation"
                            ? formatPerImagePriceLabel(price.priceData.output_cost_per_image)
                            : formatPerMillionTokenPriceLabel(
                                price.priceData.output_cost_per_token
                              )}
                        </span>
                      </div>
                      {formatPerRequestPriceLabel(price.priceData.input_cost_per_request) !==
                      "-" ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-muted-foreground">
                            {t("table.pricePerRequest")}
                          </span>
                          <span className="text-muted-foreground">
                            {formatPerRequestPriceLabel(price.priceData.input_cost_per_request)}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-right">
                    <span className="text-muted-foreground">
                      {price.priceData.supports_prompt_caching === true
                        ? formatPerMillionTokenPriceLabel(
                            price.priceData.cache_read_input_token_cost
                          )
                        : "-"}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-right">
                    {price.priceData.supports_prompt_caching === true ? (
                      <div className="space-y-1">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-muted-foreground">
                            {t("table.cache5m")}
                          </span>
                          <span className="text-muted-foreground">
                            {formatPerMillionTokenPriceLabel(
                              price.priceData.cache_creation_input_token_cost
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-muted-foreground">
                            {t("table.cache1h")}
                          </span>
                          <span className="text-muted-foreground">
                            {formatPerMillionTokenPriceLabel(
                              price.priceData.cache_creation_input_token_cost_above_1hr
                            )}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(price.updatedAt ?? price.createdAt).toLocaleDateString(locale)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={t("actions.more")}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <ModelPriceDrawer
                          mode="edit"
                          initialData={price}
                          trigger={
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                              <Pencil className="h-4 w-4 mr-2" />
                              {t("actions.edit")}
                            </DropdownMenuItem>
                          }
                        />
                        <DeleteModelDialog
                          modelName={price.modelName}
                          onSuccess={() => {
                            const willBeEmpty = filteredPrices.length <= 1 && page > 1;
                            const targetPage = willBeEmpty ? page - 1 : page;
                            if (targetPage !== page) {
                              pendingRefreshPage.current = targetPage;
                              setPage(targetPage);
                              updateURL(
                                debouncedSearchTerm,
                                targetPage,
                                pageSize,
                                sourceFilter,
                                litellmProviderFilter
                              );
                            }
                          }}
                          trigger={
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              {t("actions.delete")}
                            </DropdownMenuItem>
                          }
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    {searchTerm ? (
                      <>
                        <Search className="h-8 w-8 opacity-50" />
                        <p>{t("table.noMatch")}</p>
                      </>
                    ) : (
                      <>
                        <Package className="h-8 w-8 opacity-50" />
                        <p>{t("table.noDataTitle")}</p>
                        <p className="text-sm">{t("table.noDataHint")}</p>
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
            {t("pagination.showing", {
              from: (page - 1) * pageSize + 1,
              to: Math.min(page * pageSize, total),
              total: total,
            })}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1 || isLoading}
            >
              <ChevronLeft className="h-4 w-4" />
              {t("pagination.previous")}
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
              {t("pagination.next")}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* 统计信息 */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div className="flex items-center gap-1">
          <DollarSign className="h-4 w-4" />
          <span>{t("stats.totalModels", { count: total })}</span>
          {searchTerm && (
            <span className="text-muted-foreground">
              ({t("stats.searchResults", { count: filteredPrices.length })})
            </span>
          )}
        </div>
        <div>
          {t("stats.lastUpdated", {
            time:
              prices.length > 0
                ? new Date(
                    Math.max(...prices.map((p) => new Date(p.updatedAt ?? p.createdAt).getTime()))
                  ).toLocaleDateString(locale)
                : "-",
          })}
        </div>
      </div>
    </div>
  );
}
