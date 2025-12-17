"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CURRENCY_CONFIG, type CurrencyCode, formatCurrency } from "@/lib/utils/currency";

export interface ModelStat {
  model: string;
  callCount: number;
  totalCost: number;
}

export interface KeyStatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyName: string;
  modelStats: ModelStat[];
  currencyCode?: string;
}

export function KeyStatsDialog({
  open,
  onOpenChange,
  keyName,
  modelStats,
  currencyCode,
}: KeyStatsDialogProps) {
  const t = useTranslations("dashboard.userManagement.keyStatsDialog");
  const tCommon = useTranslations("common");

  const resolvedCurrencyCode: CurrencyCode =
    currencyCode && currencyCode in CURRENCY_CONFIG ? (currencyCode as CurrencyCode) : "USD";

  const totalCalls = modelStats.reduce((sum, stat) => sum + stat.callCount, 0);
  const totalCost = modelStats.reduce((sum, stat) => sum + stat.totalCost, 0);

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{keyName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {modelStats.length > 0 ? (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("columns.model")}</TableHead>
                      <TableHead className="text-right">{t("columns.calls")}</TableHead>
                      <TableHead className="text-right">{t("columns.cost")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modelStats.map((stat) => (
                      <TableRow key={stat.model}>
                        <TableCell className="font-mono text-xs">{stat.model}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {stat.callCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(stat.totalCost, resolvedCurrencyCode)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between px-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{t("totalCalls")}:</span>
                  <Badge variant="secondary" className="tabular-nums">
                    {totalCalls.toLocaleString()}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{t("totalCost")}:</span>
                  <Badge variant="secondary" className="font-mono tabular-nums">
                    {formatCurrency(totalCost, resolvedCurrencyCode)}
                  </Badge>
                </div>
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">{t("noData")}</div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            {tCommon("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
