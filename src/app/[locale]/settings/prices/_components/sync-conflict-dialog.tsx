"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, Eye, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ModelPriceData, SyncConflict } from "@/types/model-price";

interface SyncConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicts: SyncConflict[];
  onConfirm: (selectedModels: string[]) => void;
  isLoading?: boolean;
}

const PAGE_SIZE = 10;

/**
 * 格式化价格显示为每百万token的价格
 */
function formatPrice(value?: number): string {
  if (value === undefined || value === null) return "-";
  const pricePerMillion = value * 1000000;
  if (pricePerMillion < 0.01) {
    return `$${pricePerMillion.toFixed(4)}/M`;
  } else if (pricePerMillion < 1) {
    return `$${pricePerMillion.toFixed(3)}/M`;
  } else if (pricePerMillion < 100) {
    return `$${pricePerMillion.toFixed(2)}/M`;
  }
  return `$${pricePerMillion.toFixed(0)}/M`;
}

/**
 * 价格差异对比 Popover
 */
function PriceDiffPopover({
  manualPrice,
  litellmPrice,
}: {
  manualPrice: ModelPriceData;
  litellmPrice: ModelPriceData;
}) {
  const t = useTranslations("settings.prices.conflict");

  const diffs = useMemo(() => {
    const items: Array<{
      field: string;
      manual: string;
      litellm: string;
      changed: boolean;
    }> = [];

    // 输入价格
    const manualInput = formatPrice(manualPrice.input_cost_per_token);
    const litellmInput = formatPrice(litellmPrice.input_cost_per_token);
    items.push({
      field: t("diff.inputPrice"),
      manual: manualInput,
      litellm: litellmInput,
      changed: manualInput !== litellmInput,
    });

    // 输出价格
    const manualOutput = formatPrice(manualPrice.output_cost_per_token);
    const litellmOutput = formatPrice(litellmPrice.output_cost_per_token);
    items.push({
      field: t("diff.outputPrice"),
      manual: manualOutput,
      litellm: litellmOutput,
      changed: manualOutput !== litellmOutput,
    });

    // 图片价格（如果有）
    if (manualPrice.output_cost_per_image || litellmPrice.output_cost_per_image) {
      const manualImg = manualPrice.output_cost_per_image
        ? `$${manualPrice.output_cost_per_image}/img`
        : "-";
      const litellmImg = litellmPrice.output_cost_per_image
        ? `$${litellmPrice.output_cost_per_image}/img`
        : "-";
      items.push({
        field: t("diff.imagePrice"),
        manual: manualImg,
        litellm: litellmImg,
        changed: manualImg !== litellmImg,
      });
    }

    // 供应商
    const manualProvider = manualPrice.litellm_provider || "-";
    const litellmProvider = litellmPrice.litellm_provider || "-";
    items.push({
      field: t("diff.provider"),
      manual: manualProvider,
      litellm: litellmProvider,
      changed: manualProvider !== litellmProvider,
    });

    // 类型
    const manualMode = manualPrice.mode || "-";
    const litellmMode = litellmPrice.mode || "-";
    items.push({
      field: t("diff.mode"),
      manual: manualMode,
      litellm: litellmMode,
      changed: manualMode !== litellmMode,
    });

    return items;
  }, [manualPrice, litellmPrice, t]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
          <Eye className="h-3 w-3 mr-1" />
          {t("viewDiff")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-2">
          <div className="text-sm font-medium">{t("diffTitle")}</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24 text-xs">{t("diff.field")}</TableHead>
                <TableHead className="text-xs">{t("diff.manual")}</TableHead>
                <TableHead className="text-xs">{t("diff.litellm")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diffs.map((diff) => (
                <TableRow key={diff.field}>
                  <TableCell className="text-xs font-medium">{diff.field}</TableCell>
                  <TableCell className="text-xs font-mono">
                    {diff.changed ? (
                      <span className="text-red-600 dark:text-red-400">{diff.manual}</span>
                    ) : (
                      diff.manual
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {diff.changed ? (
                      <span className="text-green-600 dark:text-green-400">{diff.litellm}</span>
                    ) : (
                      diff.litellm
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 同步冲突对比弹窗
 */
export function SyncConflictDialog({
  open,
  onOpenChange,
  conflicts,
  onConfirm,
  isLoading = false,
}: SyncConflictDialogProps) {
  const t = useTranslations("settings.prices.conflict");
  const tCommon = useTranslations("settings.common");

  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);

  // 过滤冲突列表
  const filteredConflicts = useMemo(() => {
    if (!searchTerm.trim()) return conflicts;
    const term = searchTerm.toLowerCase();
    return conflicts.filter((c) => c.modelName.toLowerCase().includes(term));
  }, [conflicts, searchTerm]);

  // 分页
  const totalPages = Math.ceil(filteredConflicts.length / PAGE_SIZE);
  const paginatedConflicts = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredConflicts.slice(start, start + PAGE_SIZE);
  }, [filteredConflicts, page]);

  // 全选/取消全选（仅当前页）
  const allCurrentPageSelected = paginatedConflicts.every((c) => selectedModels.has(c.modelName));
  const someCurrentPageSelected =
    paginatedConflicts.some((c) => selectedModels.has(c.modelName)) && !allCurrentPageSelected;

  const handleSelectAll = (checked: boolean) => {
    const newSelected = new Set(selectedModels);
    if (checked) {
      paginatedConflicts.forEach((c) => newSelected.add(c.modelName));
    } else {
      paginatedConflicts.forEach((c) => newSelected.delete(c.modelName));
    }
    setSelectedModels(newSelected);
  };

  const handleSelectModel = (modelName: string, checked: boolean) => {
    const newSelected = new Set(selectedModels);
    if (checked) {
      newSelected.add(modelName);
    } else {
      newSelected.delete(modelName);
    }
    setSelectedModels(newSelected);
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selectedModels));
  };

  const handleCancel = () => {
    // 取消时不覆盖任何手动模型
    onConfirm([]);
  };

  // 搜索时重置页码
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setPage(1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col space-y-4">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* 冲突列表 */}
          <div className="border rounded-lg overflow-auto flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={allCurrentPageSelected}
                      ref={(el) => {
                        if (el) {
                          (el as HTMLButtonElement & { indeterminate?: boolean }).indeterminate =
                            someCurrentPageSelected;
                        }
                      }}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead>{t("table.modelName")}</TableHead>
                  <TableHead className="w-32">{t("table.manualPrice")}</TableHead>
                  <TableHead className="w-32">{t("table.litellmPrice")}</TableHead>
                  <TableHead className="w-24">{t("table.action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedConflicts.length > 0 ? (
                  paginatedConflicts.map((conflict) => (
                    <TableRow key={conflict.modelName}>
                      <TableCell>
                        <Checkbox
                          checked={selectedModels.has(conflict.modelName)}
                          onCheckedChange={(checked) =>
                            handleSelectModel(conflict.modelName, !!checked)
                          }
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{conflict.modelName}</TableCell>
                      <TableCell className="text-sm">
                        <Badge variant="outline" className="font-mono">
                          {formatPrice(conflict.manualPrice.input_cost_per_token)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <Badge variant="secondary" className="font-mono">
                          {formatPrice(conflict.litellmPrice.input_cost_per_token)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <PriceDiffPopover
                          manualPrice={conflict.manualPrice}
                          litellmPrice={conflict.litellmPrice}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      {searchTerm ? t("noMatch") : t("noConflicts")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {t("pagination.showing", {
                  from: (page - 1) * PAGE_SIZE + 1,
                  to: Math.min(page * PAGE_SIZE, filteredConflicts.length),
                  total: filteredConflicts.length,
                })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* 选中统计 */}
          <div className="text-sm text-muted-foreground">
            {t("selectedCount", { count: selectedModels.size, total: conflicts.length })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? t("applying") : t("applyOverwrite")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
