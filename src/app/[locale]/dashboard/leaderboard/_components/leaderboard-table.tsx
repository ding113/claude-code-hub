"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Award, Medal, Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
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
  cell: (row: T, index: number) => React.ReactNode;
  sortKey?: string; // 用于排序的字段名
  getValue?: (row: T) => number | string; // 获取排序值的函数
  defaultBold?: boolean; // 默认加粗（无排序时显示加粗）
}

type SortDirection = "asc" | "desc" | null;

interface LeaderboardTableProps<T> {
  data: T[];
  period: LeaderboardPeriod;
  columns: ColumnDef<T>[]; // 不包含"排名"列，组件会自动添加
  getRowKey?: (row: T, index: number) => string | number;
}

export function LeaderboardTable<T>({
  data,
  period,
  columns,
  getRowKey,
}: LeaderboardTableProps<T>) {
  const t = useTranslations("dashboard.leaderboard");

  // 排序状态
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // 判断列是否需要加粗
  const getShouldBold = (col: ColumnDef<T>) => {
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

                return (
                  <TableRow key={rowKey} className={isTopThree ? "bg-muted/50" : ""}>
                    <TableCell>{getRankBadge(rank)}</TableCell>
                    {columns.map((col, idx) => {
                      const shouldBold = getShouldBold(col);
                      return (
                        <TableCell
                          key={idx}
                          className={`${col.className || ""} ${shouldBold ? "font-bold" : ""}`}
                        >
                          {col.cell(row, index)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
