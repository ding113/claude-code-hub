"use client";

import { formatInTimeZone } from "date-fns-tz";
import { useTimeZone, useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";
import type { MyUsageLogEntry } from "@/actions/my-usage";
import { ModelVendorIcon } from "@/components/customs/model-vendor-icon";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CURRENCY_CONFIG, type CurrencyCode } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/utils/clipboard";

interface UsageLogsTableProps {
  logs: MyUsageLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  currencyCode?: CurrencyCode;
  loading?: boolean;
  loadingLabel?: string;
}

export function UsageLogsTable({
  logs,
  total,
  page,
  pageSize,
  onPageChange,
  currencyCode = "USD",
  loading = false,
  loadingLabel,
}: UsageLogsTableProps) {
  const t = useTranslations("myUsage.logs");
  const tCommon = useTranslations("common");
  const timeZone = useTimeZone() ?? "UTC";
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const formatTokenAmount = (value: number | null | undefined): string => {
    if (value == null || value === 0) return "-";
    return value.toLocaleString();
  };

  const handleCopyModel = useCallback(
    (modelId: string) => {
      void copyTextToClipboard(modelId).then((ok) => {
        if (ok) toast.success(tCommon("copySuccess"));
      });
    },
    [tCommon]
  );

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.time")}</TableHead>
              <TableHead>{t("table.model")}</TableHead>
              <TableHead className="text-right">{t("table.tokens")}</TableHead>
              <TableHead className="text-right">{t("table.cacheWrite")}</TableHead>
              <TableHead className="text-right">{t("table.cacheRead")}</TableHead>
              <TableHead className="text-right">{t("table.cost")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {Array.from({ length: 7 }).map((_, cellIndex) => (
                    <TableCell key={`skeleton-${rowIndex}-${cellIndex}`}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {t("noLogs")}
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {log.createdAt
                      ? formatInTimeZone(new Date(log.createdAt), timeZone, "yyyy-MM-dd HH:mm:ss")
                      : "-"}
                  </TableCell>
                  <TableCell className="space-y-1">
                    <div className="flex items-center gap-1.5 text-sm">
                      {log.model ? <ModelVendorIcon modelId={log.model} /> : null}
                      {log.model ? (
                        <span
                          className="cursor-pointer hover:underline truncate"
                          onClick={() => handleCopyModel(log.model!)}
                        >
                          {log.model}
                        </span>
                      ) : (
                        <span>{t("unknownModel")}</span>
                      )}
                    </div>
                    {log.modelRedirect ? (
                      <div className="text-xs text-muted-foreground">{log.modelRedirect}</div>
                    ) : null}
                    {log.billingModel && log.billingModel !== log.model ? (
                      <div className="text-[11px] text-muted-foreground">
                        {t("billingModel", { model: log.billingModel })}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right text-xs font-mono tabular-nums">
                    <div className="flex flex-col items-end leading-tight">
                      <span>{formatTokenAmount(log.inputTokens)}</span>
                      <span className="text-muted-foreground">
                        {formatTokenAmount(log.outputTokens)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    <TooltipProvider>
                      <Tooltip delayDuration={250}>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-2 w-full cursor-help">
                            {log.cacheCreationInputTokens &&
                            log.cacheCreationInputTokens > 0 &&
                            log.cacheTtlApplied ? (
                              <Badge variant="outline" className="text-[10px] leading-tight px-1">
                                {log.cacheTtlApplied}
                              </Badge>
                            ) : null}
                            <span className="ml-auto">
                              {formatTokenAmount(log.cacheCreationInputTokens)}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent align="end" className="text-xs space-y-1">
                          <div>5m: {formatTokenAmount(log.cacheCreation5mInputTokens)}</div>
                          <div>1h: {formatTokenAmount(log.cacheCreation1hInputTokens)}</div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {formatTokenAmount(log.cacheReadInputTokens)}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {CURRENCY_CONFIG[currencyCode]?.symbol ?? currencyCode}
                    {Number(log.cost ?? 0).toFixed(4)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={log.statusCode && log.statusCode >= 400 ? "destructive" : "outline"}
                      className={
                        log.statusCode === 200
                          ? "border-green-500 text-green-600 dark:text-green-400"
                          : undefined
                      }
                    >
                      {log.statusCode ?? "-"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {loading && loadingLabel
            ? loadingLabel
            : t("pagination", {
                from: (page - 1) * pageSize + 1,
                to: Math.min(page * pageSize, total),
                total,
              })}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="rounded-md border px-3 py-1 text-xs disabled:opacity-50"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1 || loading}
          >
            {t("prev")}
          </button>
          <span className="font-mono text-foreground">
            {page}/{totalPages}
          </span>
          <button
            className="rounded-md border px-3 py-1 text-xs disabled:opacity-50"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loading}
          >
            {t("next")}
          </button>
        </div>
      </div>
    </div>
  );
}
