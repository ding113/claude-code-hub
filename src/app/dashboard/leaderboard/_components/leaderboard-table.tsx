"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Medal, Award } from "lucide-react";
import type { LeaderboardEntry } from "@/repository/leaderboard";

interface LeaderboardTableProps {
  data: LeaderboardEntry[];
  period: "daily" | "monthly";
}

export function LeaderboardTable({ data, period }: LeaderboardTableProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            {period === "daily" ? "今日" : "本月"}暂无数据
          </div>
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
                <TableHead className="w-24">排名</TableHead>
                <TableHead>用户</TableHead>
                <TableHead className="text-right">请求数</TableHead>
                <TableHead className="text-right">Token 数</TableHead>
                <TableHead className="text-right">消耗金额</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((entry, index) => {
                const rank = index + 1;
                const isTopThree = rank <= 3;

                return (
                  <TableRow key={entry.userId} className={isTopThree ? "bg-muted/50" : ""}>
                    <TableCell>{getRankBadge(rank)}</TableCell>
                    <TableCell className={isTopThree ? "font-semibold" : ""}>
                      {entry.userName}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {entry.totalRequests.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {entry.totalTokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {"totalCostFormatted" in entry
                        ? (entry as { totalCostFormatted: string }).totalCostFormatted
                        : entry.totalCost}
                    </TableCell>
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
