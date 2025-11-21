"use client";
import { useState, useEffect } from "react";
import { DataTable, TableColumnTypes } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Copy, Check, ExternalLink, ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
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
import { useTranslations } from "next-intl";
import { isClipboardSupported, copyToClipboard } from "@/lib/utils/clipboard";

interface KeyListProps {
  keys: UserKeyDisplay[];
  currentUser?: User;
  keyOwnerUserId: number; // 这些Key所属的用户ID
  keyOwnerUser?: User; // 这些Key所属的用户对象（用于显示限额提示）
  currencyCode?: CurrencyCode;
}

export function KeyList({
  keys,
  currentUser,
  keyOwnerUserId,
  keyOwnerUser,
  currencyCode = "USD",
}: KeyListProps) {
  const t = useTranslations("dashboard.keyList");
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<number>>(new Set());
  const [visibleKeyIds, setVisibleKeyIds] = useState<Set<number>>(new Set());
  const [clipboardAvailable, setClipboardAvailable] = useState(false);
  const canDeleteKeys = keys.length > 1;

  // 检测 clipboard 是否可用
  useEffect(() => {
    setClipboardAvailable(isClipboardSupported());
  }, []);

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

  const toggleKeyVisibility = (keyId: number) => {
    setVisibleKeyIds((prev) => {
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

    const success = await copyToClipboard(key.fullKey);
    if (success) {
      setCopiedKeyId(key.id);
      setTimeout(() => setCopiedKeyId(null), 2000);
    }
  };

  const columns = [
    TableColumnTypes.text<UserKeyDisplay>("name", t("columns.name"), {
      render: (value, record) => {
        // 检查是否有限额配置
        const hasLimitConfig =
          (record.limit5hUsd && record.limit5hUsd > 0) ||
          (record.limitDailyUsd && record.limitDailyUsd > 0) ||
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
                    {t("detailsButton")}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-3">
                  {/* 模型统计 */}
                  {hasModelStats && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1.5">
                        {t("modelStats")} ({record.modelStats.length})
                      </div>
                      <div className="border rounded-md">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs py-1.5">
                                {t("modelStatsColumns.model")}
                              </TableHead>
                              <TableHead className="text-xs py-1.5 text-right">
                                {t("modelStatsColumns.calls")}
                              </TableHead>
                              <TableHead className="text-xs py-1.5 text-right">
                                {t("modelStatsColumns.cost")}
                              </TableHead>
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
                        {t("limitUsage")}
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
    TableColumnTypes.text<UserKeyDisplay>("maskedKey", t("columns.key"), {
      render: (_, record: UserKeyDisplay) => {
        const isVisible = visibleKeyIds.has(record.id);
        const displayKey = isVisible && record.fullKey ? record.fullKey : record.maskedKey || "-";

        return (
          <div className="group inline-flex items-center gap-1">
            <div className={`font-mono ${isVisible ? "select-all" : "truncate"}`}>{displayKey}</div>
            {record.canCopy && record.fullKey && (
              <>
                {clipboardAvailable ? (
                  // HTTPS 环境：显示复制按钮
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopyKey(record)}
                    className="h-5 w-5 p-0 hover:bg-muted flex-shrink-0"
                    title={t("copyKeyTooltip")}
                  >
                    {copiedKeyId === record.id ? (
                      <Check className="h-3 w-3 text-green-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                ) : (
                  // HTTP 环境：显示显示/隐藏按钮
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleKeyVisibility(record.id)}
                    className="h-5 w-5 p-0 hover:bg-muted flex-shrink-0"
                    title={isVisible ? t("hideKeyTooltip") : t("showKeyTooltip")}
                  >
                    {isVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </Button>
                )}
              </>
            )}
          </div>
        );
      },
    }),
    TableColumnTypes.text<UserKeyDisplay>("todayCallCount", t("columns.todayCalls"), {
      render: (value) => (
        <div className="text-sm">
          {typeof value === "number" ? value.toLocaleString() : 0} {t("timesUnit")}
        </div>
      ),
    }),
    TableColumnTypes.number<UserKeyDisplay>("todayUsage", t("columns.todayCost"), {
      render: (value) => {
        const amount = typeof value === "number" ? value : 0;
        return formatCurrency(amount, currencyCode);
      },
    }),
    TableColumnTypes.text<UserKeyDisplay>("lastUsedAt", t("columns.lastUsed"), {
      render: (_, record: UserKeyDisplay) => (
        <div className="space-y-0.5">
          {record.lastUsedAt ? (
            <>
              <div className="text-sm">
                <RelativeTime date={record.lastUsedAt} />
              </div>
              {record.lastProviderName && (
                <div className="text-xs text-muted-foreground">
                  {t("provider")}: {record.lastProviderName}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">{t("neverUsed")}</div>
          )}
        </div>
      ),
    }),
    TableColumnTypes.actions<UserKeyDisplay>(t("columns.actions"), (value, record) => (
      <div className="flex items-center gap-1">
        <Link href={`/dashboard/logs?keyId=${record.id}`}>
          <Button variant="ghost" size="sm" className="h-7 text-xs" title={t("viewLogsTooltip")}>
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            {t("logsButton")}
          </Button>
        </Link>
        <KeyActions
          keyData={record}
          currentUser={currentUser}
          keyOwnerUserId={keyOwnerUserId}
          keyOwnerUser={keyOwnerUser}
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
        title: t("emptyState.title"),
        description: t("emptyState.description"),
      }}
      maxHeight="600px"
      stickyHeader
    />
  );
}
