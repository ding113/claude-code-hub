"use client";

import { useTranslations } from "next-intl";
import type { MyUsageLogEntry } from "@/actions/my-usage";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CurrencyCode } from "@/lib/utils";

interface UsageLogsTableProps {
  logs: MyUsageLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  currencyCode?: CurrencyCode;
}

export function UsageLogsTable({
  logs,
  total,
  page,
  pageSize,
  onPageChange,
  currencyCode = "USD",
}: UsageLogsTableProps) {
  const t = useTranslations("myUsage.logs");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.time")}</TableHead>
              <TableHead>{t("table.model")}</TableHead>
              <TableHead className="text-right">{t("table.tokens")}</TableHead>
              <TableHead className="text-right">
                {t("table.cost", { currency: currencyCode })}
              </TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>{t("table.endpoint")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {t("noLogs")}
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {log.createdAt ? new Date(log.createdAt).toLocaleString() : "-"}
                  </TableCell>
                  <TableCell className="space-y-1">
                    <div className="font-medium text-sm">{log.model ?? t("unknownModel")}</div>
                    {log.modelRedirect ? (
                      <div className="text-xs text-muted-foreground">{log.modelRedirect}</div>
                    ) : null}
                    {log.billingModel && log.billingModel !== log.model ? (
                      <div className="text-[11px] text-muted-foreground">
                        {t("billingModel", { model: log.billingModel })}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {log.inputTokens}/{log.outputTokens}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {currencyCode} {(log.cost ?? 0).toFixed(4)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={log.statusCode && log.statusCode >= 400 ? "destructive" : "outline"}
                    >
                      {log.statusCode ?? "-"}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                    {log.endpoint || "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {t("pagination", {
            from: (page - 1) * pageSize + 1,
            to: Math.min(page * pageSize, total),
            total,
          })}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="rounded-md border px-3 py-1 text-xs disabled:opacity-50"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
          >
            {t("prev")}
          </button>
          <span className="font-mono text-foreground">
            {page}/{totalPages}
          </span>
          <button
            className="rounded-md border px-3 py-1 text-xs disabled:opacity-50"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
          >
            {t("next")}
          </button>
        </div>
      </div>
    </div>
  );
}
