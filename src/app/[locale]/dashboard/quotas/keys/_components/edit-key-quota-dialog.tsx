"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Loader2 } from "lucide-react";
import { editKey } from "@/actions/keys";
import { toast } from "sonner";
import { type CurrencyCode, CURRENCY_CONFIG } from "@/lib/utils/currency";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface KeyQuota {
  cost5h: { current: number; limit: number | null };
  costDaily: { current: number; limit: number | null; resetAt?: Date };
  costWeekly: { current: number; limit: number | null };
  costMonthly: { current: number; limit: number | null };
  concurrentSessions: { current: number; limit: number };
}

interface EditKeyQuotaDialogProps {
  keyId: number;
  keyName: string;
  userName: string;
  currentQuota: KeyQuota | null;
  currencyCode?: CurrencyCode;
  trigger?: React.ReactNode;
  dailyResetTime?: string;
  dailyResetMode?: "fixed" | "rolling";
}

export function EditKeyQuotaDialog({
  keyId,
  keyName,
  userName,
  currentQuota,
  currencyCode = "USD",
  trigger,
  dailyResetTime = "00:00",
  dailyResetMode = "fixed",
}: EditKeyQuotaDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const t = useTranslations("quota.keys.editDialog");

  const currencySymbol = CURRENCY_CONFIG[currencyCode].symbol;

  // 表单状态
  const [limit5h, setLimit5h] = useState<string>(currentQuota?.cost5h.limit?.toString() ?? "");
  const [limitDaily, setLimitDaily] = useState<string>(
    currentQuota?.costDaily.limit?.toString() ?? ""
  );
  const [resetMode, setResetMode] = useState<"fixed" | "rolling">(dailyResetMode);
  const [resetTime, setResetTime] = useState<string>(dailyResetTime);
  const [limitWeekly, setLimitWeekly] = useState<string>(
    currentQuota?.costWeekly.limit?.toString() ?? ""
  );
  const [limitMonthly, setLimitMonthly] = useState<string>(
    currentQuota?.costMonthly.limit?.toString() ?? ""
  );
  const [limitConcurrent, setLimitConcurrent] = useState<string>(
    currentQuota?.concurrentSessions.limit?.toString() ?? "0"
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    startTransition(async () => {
      try {
        // 将空字符串转换为 null，数字字符串转换为数字
        const result = await editKey(keyId, {
          name: keyName, // 保持名称不变
          limit5hUsd: limit5h ? parseFloat(limit5h) : null,
          limitDailyUsd: limitDaily ? parseFloat(limitDaily) : null,
          dailyResetMode: resetMode,
          dailyResetTime: resetTime,
          limitWeeklyUsd: limitWeekly ? parseFloat(limitWeekly) : null,
          limitMonthlyUsd: limitMonthly ? parseFloat(limitMonthly) : null,
          limitConcurrentSessions: limitConcurrent ? parseInt(limitConcurrent, 10) : 0,
        });

        if (result.ok) {
          toast.success(t("success"));
          setOpen(false);
          router.refresh();
        } else {
          toast.error(result.error || t("error"));
        }
      } catch (error) {
        toast.error(t("retryError"));
        console.error(error);
      }
    });
  };

  const handleClearQuota = () => {
    startTransition(async () => {
      try {
        const result = await editKey(keyId, {
          name: keyName,
          limit5hUsd: null,
          limitDailyUsd: null,
          dailyResetMode: resetMode,
          dailyResetTime: resetTime,
          limitWeeklyUsd: null,
          limitMonthlyUsd: null,
          limitConcurrentSessions: 0,
        });

        if (result.ok) {
          toast.success(t("clearSuccess"));
          setOpen(false);
          router.refresh();
        } else {
          toast.error(result.error || t("clearError"));
        }
      } catch (error) {
        toast.error(t("retryError"));
        console.error(error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4" />
            <span className="ml-2">{t("setQuota")}</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[70vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { keyName, userName })}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="grid gap-3 py-3 overflow-y-auto pr-2 flex-1">
            {/* 成本限额 - 双栏布局 */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {/* 5小时限额 */}
              <div className="grid gap-1.5">
                <Label htmlFor="limit5h" className="text-xs">
                  {t("cost5h.label")}
                </Label>
                <Input
                  id="limit5h"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={t("cost5h.placeholder")}
                  value={limit5h}
                  onChange={(e) => setLimit5h(e.target.value)}
                  className="h-9"
                />
                {currentQuota?.cost5h.limit && (
                  <p className="text-xs text-muted-foreground">
                    {t("cost5h.current", {
                      currency: currencySymbol,
                      current: currentQuota.cost5h.current.toFixed(4),
                      limit: currentQuota.cost5h.limit.toFixed(2),
                    })}
                  </p>
                )}
              </div>

              {/* 每日限额 */}
              <div className="grid gap-1.5">
                <Label htmlFor="limitDaily" className="text-xs">
                  {t("costDaily.label")}
                </Label>
                <Input
                  id="limitDaily"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={t("costDaily.placeholder")}
                  value={limitDaily}
                  onChange={(e) => setLimitDaily(e.target.value)}
                  className="h-9"
                />
                {currentQuota?.costDaily.limit && (
                  <p className="text-xs text-muted-foreground">
                    {t("costDaily.current", {
                      currency: currencySymbol,
                      current: currentQuota.costDaily.current.toFixed(4),
                      limit: currentQuota.costDaily.limit.toFixed(2),
                    })}
                  </p>
                )}
              </div>

              {/* 每日重置模式 */}
              <div className="grid gap-1.5">
                <Label htmlFor="dailyResetMode" className="text-xs">
                  {t("dailyResetMode.label")}
                </Label>
                <Select
                  value={resetMode}
                  onValueChange={(value: "fixed" | "rolling") => setResetMode(value)}
                  disabled={isPending}
                >
                  <SelectTrigger id="dailyResetMode" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">{t("dailyResetMode.options.fixed")}</SelectItem>
                    <SelectItem value="rolling">{t("dailyResetMode.options.rolling")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {resetMode === "fixed"
                    ? t("dailyResetMode.desc.fixed")
                    : t("dailyResetMode.desc.rolling")}
                </p>
              </div>

              {/* 每日重置时间 - 仅在固定时间模式下显示 */}
              {resetMode === "fixed" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="dailyResetTime" className="text-xs">
                    {t("dailyResetTime.label")}
                  </Label>
                  <Input
                    id="dailyResetTime"
                    type="time"
                    step={60}
                    value={resetTime}
                    onChange={(e) => setResetTime(e.target.value || "00:00")}
                    className="h-9"
                  />
                </div>
              )}

              {/* 周限额 */}
              <div className="grid gap-1.5">
                <Label htmlFor="limitWeekly" className="text-xs">
                  {t("costWeekly.label")}
                </Label>
                <Input
                  id="limitWeekly"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={t("costWeekly.placeholder")}
                  value={limitWeekly}
                  onChange={(e) => setLimitWeekly(e.target.value)}
                  className="h-9"
                />
                {currentQuota?.costWeekly.limit && (
                  <p className="text-xs text-muted-foreground">
                    {t("costWeekly.current", {
                      currency: currencySymbol,
                      current: currentQuota.costWeekly.current.toFixed(4),
                      limit: currentQuota.costWeekly.limit.toFixed(2),
                    })}
                  </p>
                )}
              </div>

              {/* 月限额 */}
              <div className="grid gap-1.5">
                <Label htmlFor="limitMonthly" className="text-xs">
                  {t("costMonthly.label")}
                </Label>
                <Input
                  id="limitMonthly"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={t("costMonthly.placeholder")}
                  value={limitMonthly}
                  onChange={(e) => setLimitMonthly(e.target.value)}
                  className="h-9"
                />
                {currentQuota?.costMonthly.limit && (
                  <p className="text-xs text-muted-foreground">
                    {t("costMonthly.current", {
                      currency: currencySymbol,
                      current: currentQuota.costMonthly.current.toFixed(4),
                      limit: currentQuota.costMonthly.limit.toFixed(2),
                    })}
                  </p>
                )}
              </div>

              {/* 并发限额 */}
              <div className="grid gap-1.5">
                <Label htmlFor="limitConcurrent" className="text-xs">
                  {t("concurrentSessions.label")}
                </Label>
                <Input
                  id="limitConcurrent"
                  type="number"
                  min="0"
                  placeholder={t("concurrentSessions.placeholder")}
                  value={limitConcurrent}
                  onChange={(e) => setLimitConcurrent(e.target.value)}
                  className="h-9"
                />
                {currentQuota && currentQuota.concurrentSessions.limit > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("concurrentSessions.current", {
                      current: currentQuota.concurrentSessions.current,
                      limit: currentQuota.concurrentSessions.limit,
                    })}
                  </p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 flex-shrink-0 pt-3 border-t">
            {(currentQuota?.cost5h.limit ||
              currentQuota?.costWeekly.limit ||
              currentQuota?.costMonthly.limit ||
              (currentQuota?.concurrentSessions.limit ?? 0) > 0) && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleClearQuota}
                disabled={isPending}
              >
                {t("clearAll")}
              </Button>
            )}
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
