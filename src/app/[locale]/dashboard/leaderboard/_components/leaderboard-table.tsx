"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Award,
  ChevronDown,
  ChevronRight,
  Medal,
  Trophy,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LeaderboardPeriod } from "@/repository/leaderboard";

// 支持动态列定义
export interface ColumnDef<T> {
  header: string;
  className?: string;
  /**
   * index 语义：
   * - 父行：按当前排序后的全局行序（从 0 开始）
   * - 子行：父行内的子行序（从 0 开始）
   */
  cell: (row: T, index: number, isSubRow?: boolean) => React.ReactNode;
  sortKey?: string; // 用于排序的字段名
  getValue?: (row: T) => number | string | null; // 获取排序值的函数
  defaultBold?: boolean; // 默认加粗（无排序时显示加粗）
}

type SortDirection = "asc" | "desc" | null;

interface LeaderboardTableProps<TParent, TSub = TParent> {
  data: TParent[];
  period: LeaderboardPeriod;
  columns: ColumnDef<TParent | TSub>[]; // 不包含"排名"列，组件会自动添加
  getRowKey?: (row: TParent, index: number) => string | number;
  /** 返回子行数据（非空且长度 > 0 时，父行展示可展开图标） */
  getSubRows?: (row: TParent, index: number) => TSub[] | null | undefined;
  /** 子行的 React key（默认使用 `${parentKey}-${subIndex}` 组合） */
  getSubRowKey?: (
    subRow: TSub,
    parentRow: TParent,
    parentIndex: number,
    subIndex: number
  ) => string | number;
}

export function LeaderboardTable<TParent, TSub = TParent>({
  data,
  period,
  columns,
  getRowKey,
  getSubRows,
  getSubRowKey,
}: LeaderboardTableProps<TParent, TSub>) {
  const t = useTranslations("dashboard.leaderboard");
  type TableRow = TParent | TSub;

  // 排序状态
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // 展开行状态
  const [expandedRows, setExpandedRows] = useState<Set<string | number>>(new Set());
  const toggleRow = (key: string | number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // 当调用方未提供稳定 rowKey 时（回退到 index），排序会导致展开态错位；此时在排序/数据变化时清空展开态，至少避免错位展开。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 依赖用于在排序/数据变化时触发清空，避免 index key 造成错位展开
  useEffect(() => {
    if (!getRowKey) {
      setExpandedRows(new Set());
    }
  }, [data, sortKey, sortDirection, getRowKey]);

  // 判断列是否需要加粗
  const getShouldBold = (col: ColumnDef<TableRow>) => {
    const isActiveSortColumn = sortKey === col.sortKey && sortDirection !== null;
    const noSorting = sortKey === null;
    return isActiveSortColumn || (col.defaultBold && noSorting);
  };
  // 处理表头点击排序
  const handleSort = (key: string | undefined) => {
    if (!key) return;

    if (sortKey === key) {
      // 循环切换：asc -> desc -> null
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortKey(null);
        setSortDirection(null);
      }
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  // 排序后的数据
  const sortedData = useMemo(() => {
    if (!sortKey || !sortDirection) return data;

    const column = columns.find((col) => col.sortKey === sortKey);
    if (!column?.getValue) return data;

    return [...data].sort((a, b) => {
      const valueA = column.getValue!(a);
      const valueB = column.getValue!(b);

      // N/A/null values should always sort after real values.
      if (valueA == null && valueB == null) return 0;
      if (valueA == null) return 1;
      if (valueB == null) return -1;

      if (typeof valueA === "number" && typeof valueB === "number") {
        return sortDirection === "asc" ? valueA - valueB : valueB - valueA;
      }

      const strA = String(valueA);
      const strB = String(valueB);
      return sortDirection === "asc" ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });
  }, [data, sortKey, sortDirection, columns]);

  // 获取排序图标
  const getSortIcon = (key: string | undefined) => {
    if (!key) return null;
    if (sortKey !== key) {
      return <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground/50" />;
    }
    if (sortDirection === "asc") {
      return <ArrowUp className="ml-1 h-3 w-3" />;
    }
    return <ArrowDown className="ml-1 h-3 w-3" />;
  };

  if (data.length === 0) {
    const noDataKey =
      period === "daily"
        ? "states.todayNoData"
        : period === "weekly"
          ? "states.weekNoData"
          : period === "monthly"
            ? "states.monthNoData"
            : "states.noData";
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">{t(noDataKey)}</div>
        </CardContent>
      </Card>
    );
  }

  const getRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <div className="flex items-center gap-1.5">
          <Trophy className="h-4 w-4 text-yellow-500" />
          <Badge
            variant="default"
            className="bg-yellow-500 hover:bg-yellow-600 min-w-[32px] justify-center"
          >
            #{rank}
          </Badge>
        </div>
      );
    }
    if (rank === 2) {
      return (
        <div className="flex items-center gap-1.5">
          <Medal className="h-4 w-4 text-gray-400" />
          <Badge
            variant="secondary"
            className="bg-gray-400 hover:bg-gray-500 text-white min-w-[32px] justify-center"
          >
            #{rank}
          </Badge>
        </div>
      );
    }
    if (rank === 3) {
      return (
        <div className="flex items-center gap-1.5">
          <Award className="h-4 w-4 text-orange-600" />
          <Badge
            variant="secondary"
            className="bg-orange-600 hover:bg-orange-700 text-white min-w-[32px] justify-center"
          >
            #{rank}
          </Badge>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1.5">
        <div className="h-4 w-4" />
        <Badge variant="outline" className="min-w-[32px] justify-center">
          #{rank}
        </Badge>
      </div>
    );
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">{t("columns.rank")}</TableHead>
                {columns.map((col, idx) => {
                  const shouldBold = getShouldBold(col);
                  return (
                    <TableHead
                      key={idx}
                      className={`${col.className || ""} ${col.sortKey ? "cursor-pointer select-none hover:bg-muted/50 transition-colors" : ""}`}
                      onClick={col.sortKey ? () => handleSort(col.sortKey) : undefined}
                    >
                      <div
                        className={`flex items-center ${col.className?.includes("text-right") ? "justify-end" : ""} ${shouldBold ? "font-bold" : ""}`}
                      >
                        {col.header}
                        {col.sortKey && getSortIcon(col.sortKey)}
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedData.map((row, index) => {
                const rank = index + 1;
                const isTopThree = rank <= 3;
                const rowKey = getRowKey ? (getRowKey(row, index) ?? index) : index;
                const subRows = getSubRows ? getSubRows(row, index) : null;
                const hasExpandable = (subRows?.length ?? 0) > 0;
                const isExpanded = hasExpandable && expandedRows.has(rowKey);

                return (
                  <Fragment key={rowKey}>
                    <TableRow className={`${isTopThree ? "bg-muted/50" : ""}`}>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {hasExpandable ? (
                            <button
                              type="button"
                              className="inline-flex items-center cursor-pointer rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              onClick={() => toggleRow(rowKey)}
                              aria-expanded={isExpanded}
                              aria-label={
                                isExpanded ? t("collapseModelStats") : t("expandModelStats")
                              }
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                              )}
                            </button>
                          ) : (
                            <div className="h-4 w-4" aria-hidden="true" />
                          )}
                          {getRankBadge(rank)}
                        </div>
                      </TableCell>
                      {columns.map((col, idx) => {
                        const shouldBold = getShouldBold(col);
                        return (
                          <TableCell
                            key={idx}
                            className={`${col.className || ""} ${shouldBold ? "font-bold" : ""}`}
                          >
                            {col.cell(row, index, false)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                    {isExpanded &&
                      (subRows ?? []).map((subRow, subIndex) => {
                        const rawSubKey = getSubRowKey
                          ? getSubRowKey(subRow, row, index, subIndex)
                          : subIndex;
                        const subKey = `${rowKey}-${String(rawSubKey)}`;
                        return (
                          <TableRow key={subKey} className="bg-muted/30 hover:bg-muted/30">
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <div className="h-4 w-4" />
                              </div>
                            </TableCell>
                            {columns.map((col, idx) => {
                              const shouldBold = getShouldBold(col);
                              return (
                                <TableCell
                                  key={idx}
                                  className={`${col.className || ""} ${shouldBold ? "font-bold" : ""}`}
                                >
                                  {col.cell(subRow, subIndex, true)}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        );
                      })}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
