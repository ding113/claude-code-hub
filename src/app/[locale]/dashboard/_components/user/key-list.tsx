"use client";
import { useState } from "react";
import { DataTable, TableColumnTypes } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Copy, Check, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { KeyActions } from "./key-actions";
import { KeyLimitUsage } from "./key-limit-usage";
import type { UserKeyDisplay } from "@/types/user";
import type { User } from "@/types/user";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatCurrency, type CurrencyCode } from "@/lib/utils/currency";
import { Link } from "@/i18n/routing";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface KeyListProps {
  keys: UserKeyDisplay[];
  currentUser?: User;
  keyOwnerUserId: number; // 这些Key所属的用户ID
  currencyCode?: CurrencyCode;
}

export function KeyList({ keys, currentUser, keyOwnerUserId, currencyCode = "USD" }: KeyListProps) {
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<number>>(new Set());
  const canDeleteKeys = keys.length > 1;

  const toggleExpanded = (keyId: number) => {
    setExpandedKeys((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(keyId)) {
        newSet.delete(keyId);
      } else {
        newSet.add(keyId);
      }
      return newSet;
    });
  };

  const handleCopyKey = async (key: UserKeyDisplay) => {
    if (!key.fullKey || !key.canCopy) return;

    try {
      await navigator.clipboard.writeText(key.fullKey);
      setCopiedKeyId(key.id);
      setTimeout(() => setCopiedKeyId(null), 2000);
    } catch (err) {
      console.error("复制失败:", err);
    }
  };

  const columns = [
    TableColumnTypes.text<UserKeyDisplay>("name", "名称", {
      render: (value, record) => {
        // 检查是否有限额配置
        const hasLimitConfig =
          (record.limit5hUsd && record.limit5hUsd > 0) ||
          (record.limitWeeklyUsd && record.limitWeeklyUsd > 0) ||
          (record.limitMonthlyUsd && record.limitMonthlyUsd > 0) ||
          (record.limitConcurrentSessions && record.limitConcurrentSessions > 0);

        const hasModelStats = record.modelStats.length > 0;
        const showDetails = hasModelStats || hasLimitConfig;

        return (
          <div className="space-y-1">
            <div className="truncate font-medium">{value}</div>
            {showDetails && (
              <Collapsible open={expandedKeys.has(record.id)}>
                <CollapsibleTrigger asChild>
                  <button
                    onClick={() => toggleExpanded(record.id)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {expandedKeys.has(record.id) ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    详细信息
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-3">
                  {/* 模型统计 */}
                  {hasModelStats && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1.5">
                        模型统计 ({record.modelStats.length})
                      </div>
                      <div className="border rounded-md">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs py-1.5">模型</TableHead>
                              <TableHead className="text-xs py-1.5 text-right">调用次数</TableHead>
                              <TableHead className="text-xs py-1.5 text-right">消耗</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {record.modelStats.map((stat) => (
                              <TableRow key={stat.model}>
                                <TableCell className="text-xs py-1.5 font-mono">
                                  {stat.model}
                                </TableCell>
                                <TableCell className="text-xs py-1.5 text-right">
                                  {stat.callCount}
                                </TableCell>
                                <TableCell className="text-xs py-1.5 text-right font-mono">
                                  {formatCurrency(stat.totalCost, currencyCode)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* 限额使用情况 */}
                  {hasLimitConfig && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1.5">
                        限额使用情况
                      </div>
                      <div className="border rounded-md p-3 bg-muted/30">
                        <KeyLimitUsage keyId={record.id} currencyCode={currencyCode} />
                      </div>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        );
      },
    }),
    TableColumnTypes.text<UserKeyDisplay>("maskedKey", "Key", {
      render: (_, record: UserKeyDisplay) => (
        <div className="group inline-flex items-center gap-1">
          <div className="font-mono truncate">{record.maskedKey || "-"}</div>
          {record.canCopy && record.fullKey && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCopyKey(record)}
              className="h-5 w-5 p-0 hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              title="复制完整密钥"
            >
              {copiedKeyId === record.id ? (
                <Check className="h-3 w-3 text-green-600" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          )}
        </div>
      ),
    }),
    TableColumnTypes.text<UserKeyDisplay>("todayCallCount", "今日调用", {
      render: (value) => (
        <div className="text-sm">{typeof value === "number" ? value.toLocaleString() : 0} 次</div>
      ),
    }),
    TableColumnTypes.number<UserKeyDisplay>("todayUsage", "今日消耗", {
      render: (value) => {
        const amount = typeof value === "number" ? value : 0;
        return formatCurrency(amount, currencyCode);
      },
    }),
    TableColumnTypes.text<UserKeyDisplay>("lastUsedAt", "最后使用", {
      render: (_, record: UserKeyDisplay) => (
        <div className="space-y-0.5">
          {record.lastUsedAt ? (
            <>
              <div className="text-sm">
                <RelativeTime date={record.lastUsedAt} />
              </div>
              {record.lastProviderName && (
                <div className="text-xs text-muted-foreground">
                  供应商: {record.lastProviderName}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">未使用</div>
          )}
        </div>
      ),
    }),
    TableColumnTypes.actions<UserKeyDisplay>("操作", (value, record) => (
      <div className="flex items-center gap-1">
        <Link href={`/dashboard/logs?keyId=${record.id}`}>
          <Button variant="ghost" size="sm" className="h-7 text-xs" title="查看详细日志">
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            日志
          </Button>
        </Link>
        <KeyActions
          keyData={record}
          currentUser={currentUser}
          keyOwnerUserId={keyOwnerUserId}
          canDelete={canDeleteKeys}
        />
      </div>
    )),
  ];

  return (
    <DataTable
      columns={columns}
      data={keys}
      emptyState={{
        title: "暂无 Key",
        description: '可点击右上角 "新增 Key" 按钮添加密钥',
      }}
      maxHeight="600px"
      stickyHeader
    />
  );
}
