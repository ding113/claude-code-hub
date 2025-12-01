"use client";

import { Award, Medal, Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
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
}

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
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-yellow-500" />
          <Badge variant="default" className="bg-yellow-500 hover:bg-yellow-600">
            #{rank}
          </Badge>
        </div>
      );
    } else if (rank === 2) {
      return (
        <div className="flex items-center gap-2">
          <Medal className="h-5 w-5 text-gray-400" />
          <Badge variant="secondary" className="bg-gray-400 hover:bg-gray-500 text-white">
            #{rank}
          </Badge>
        </div>
      );
    } else if (rank === 3) {
      return (
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5 text-orange-600" />
          <Badge variant="secondary" className="bg-orange-600 hover:bg-orange-700 text-white">
            #{rank}
          </Badge>
        </div>
      );
    }

    return <div className="text-muted-foreground font-medium">#{rank}</div>;
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">{t("columns.rank")}</TableHead>
                {columns.map((col, idx) => (
                  <TableHead key={idx} className={col.className || ""}>
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row, index) => {
                const rank = index + 1;
                const isTopThree = rank <= 3;

                return (
                  <TableRow
                    key={(getRowKey ? getRowKey(row, index) : index) as React.Key}
                    className={isTopThree ? "bg-muted/50" : ""}
                  >
                    <TableCell>{getRankBadge(rank)}</TableCell>
                    {columns.map((col, idx) => (
                      <TableCell key={idx} className={col.className || ""}>
                        {col.cell(row, index)}
                      </TableCell>
                    ))}
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
