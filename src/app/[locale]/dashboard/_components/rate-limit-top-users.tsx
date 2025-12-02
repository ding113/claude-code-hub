"use client";

import { ArrowUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { getUsers } from "@/actions/users";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface RateLimitTopUsersProps {
  data: Record<number, number>;
}

type SortField = "name" | "count";
type SortDirection = "asc" | "desc";

/**
 * 受影响用户排行榜
 * 显示触发限流最多的用户列表
 */
export function RateLimitTopUsers({ data }: RateLimitTopUsersProps) {
  const t = useTranslations("dashboard.rateLimits.topUsers");
  const [users, setUsers] = React.useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = React.useState(true);
  const [sortField, setSortField] = React.useState<SortField>("count");
  const [sortDirection, setSortDirection] = React.useState<SortDirection>("desc");

  // 加载用户详情
  React.useEffect(() => {
    getUsers().then((userList) => {
      setUsers(userList);
      setLoading(false);
    });
  }, []);

  // 组合数据：用户信息 + 事件计数
  const tableData = React.useMemo(() => {
    const userMap = new Map(users.map((u) => [u.id, u.name]));

    return Object.entries(data)
      .map(([userId, count]) => ({
        userId: Number(userId),
        username: userMap.get(Number(userId)) || `User #${userId}`,
        eventCount: count,
      }))
      .sort((a, b) => {
        if (sortField === "name") {
          const comparison = a.username.localeCompare(b.username, "zh-CN");
          return sortDirection === "asc" ? comparison : -comparison;
        } else {
          const comparison = a.eventCount - b.eventCount;
          return sortDirection === "asc" ? comparison : -comparison;
        }
      });
  }, [users, data, sortField, sortDirection]);

  // 切换排序
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection(field === "count" ? "desc" : "asc");
    }
  };

  const totalEvents = React.useMemo(() => {
    return Object.values(data).reduce((sum, count) => sum + count, 0);
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          {t("description")} · {t("total")}: {totalEvents.toLocaleString()}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-[280px] items-center justify-center text-muted-foreground">
            {t("loading")}
          </div>
        ) : tableData.length === 0 ? (
          <div className="flex h-[280px] items-center justify-center text-muted-foreground">
            {t("noData")}
          </div>
        ) : (
          <div className="relative max-h-[280px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">{t("rank")}</TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => toggleSort("name")}
                    >
                      {t("username")}
                      <ArrowUpDown className="ml-1 h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => toggleSort("count")}
                    >
                      {t("eventCount")}
                      <ArrowUpDown className="ml-1 h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-right w-[100px]">{t("percentage")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableData.map((row, index) => {
                  const percentage = ((row.eventCount / totalEvents) * 100).toFixed(1);
                  return (
                    <TableRow key={row.userId}>
                      <TableCell className="font-medium">#{index + 1}</TableCell>
                      <TableCell>{row.username}</TableCell>
                      <TableCell className="text-right font-mono">
                        {row.eventCount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {percentage}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
