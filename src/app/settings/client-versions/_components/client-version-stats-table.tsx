"use client";

import type { ClientVersionStats } from "@/lib/client-version-checker";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";

interface ClientVersionStatsTableProps {
  data: ClientVersionStats[];
}

export function ClientVersionStatsTable({ data }: ClientVersionStatsTableProps) {
  return (
    <div className="space-y-8">
      {data.map((clientStats) => (
        <div key={clientStats.clientType} className="space-y-3">
          {/* 客户端类型标题 */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">{clientStats.clientType}</h3>
              <p className="text-sm text-muted-foreground">
                当前 GA 版本：
                <Badge variant="outline" className="ml-2">
                  {clientStats.gaVersion || "无（用户数不足 2）"}
                </Badge>
              </p>
            </div>
            <Badge variant="secondary">{clientStats.totalUsers} 位用户</Badge>
          </div>

          {/* 用户版本列表 */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户</TableHead>
                  <TableHead>当前版本</TableHead>
                  <TableHead>最后活跃时间</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientStats.users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      暂无用户数据
                    </TableCell>
                  </TableRow>
                ) : (
                  clientStats.users.map((user) => (
                    <TableRow key={`${user.userId}-${user.version}`}>
                      <TableCell className="font-medium">{user.username}</TableCell>
                      <TableCell>
                        <code className="rounded bg-muted px-2 py-1 text-sm">{user.version}</code>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(user.lastSeen), {
                          addSuffix: true,
                          locale: zhCN,
                        })}
                      </TableCell>
                      <TableCell>
                        {user.isLatest ? (
                          <Badge variant="default" className="bg-green-500 hover:bg-green-600">
                            ✅ 最新
                          </Badge>
                        ) : user.needsUpgrade ? (
                          <Badge variant="destructive">⚠️ 需升级</Badge>
                        ) : (
                          <Badge variant="outline">未知</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  );
}
