"use client";

import { Loader2, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { editUser } from "@/actions/users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CURRENCY_CONFIG, type CurrencyCode } from "@/lib/utils/currency";

interface UserQuota {
  rpm: { current: number; limit: number; window: "per_minute" };
  dailyCost: { current: number; limit: number; resetAt: Date };
}

interface EditUserQuotaDialogProps {
  userId: number;
  userName: string;
  currentQuota: UserQuota | null;
  currencyCode?: CurrencyCode;
  trigger?: React.ReactNode;
}

export function EditUserQuotaDialog({
  userId,
  userName,
  currentQuota,
  currencyCode = "USD",
  trigger,
}: EditUserQuotaDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const t = useTranslations("quota.keys.editUserDialog");

  const currencySymbol = CURRENCY_CONFIG[currencyCode].symbol;

  // 表单状态
  const [rpmLimit, setRpmLimit] = useState<string>(currentQuota?.rpm.limit?.toString() ?? "60");
  const [dailyQuota, setDailyQuota] = useState<string>(
    currentQuota?.dailyCost.limit?.toString() ?? "100"
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    startTransition(async () => {
      try {
        const result = await editUser(userId, {
          rpm: rpmLimit ? parseInt(rpmLimit, 10) : 60,
          dailyQuota: dailyQuota ? parseFloat(dailyQuota) : 100,
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4" />
            <span className="ml-2">{t("editQuota")}</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[70vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { userName })}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="grid gap-3 py-3 overflow-y-auto pr-2 flex-1">
            {/* 配额设置 - 双栏布局 */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {/* RPM 限制 */}
              <div className="grid gap-1.5">
                <Label htmlFor="rpmLimit" className="text-xs">
                  {t("rpm.label")}
                </Label>
                <Input
                  id="rpmLimit"
                  type="number"
                  min="1"
                  placeholder={t("rpm.placeholder")}
                  value={rpmLimit}
                  onChange={(e) => setRpmLimit(e.target.value)}
                  required
                  className="h-9"
                />
                {currentQuota && (
                  <p className="text-xs text-muted-foreground">
                    {t("rpm.current", {
                      current: currentQuota.rpm.current,
                      limit: currentQuota.rpm.limit,
                    })}
                  </p>
                )}
              </div>

              {/* 每日消费限额 */}
              <div className="grid gap-1.5">
                <Label htmlFor="dailyQuota" className="text-xs">
                  {t("dailyQuota.label")}
                </Label>
                <Input
                  id="dailyQuota"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={t("dailyQuota.placeholder")}
                  value={dailyQuota}
                  onChange={(e) => setDailyQuota(e.target.value)}
                  required
                  className="h-9"
                />
                {currentQuota && (
                  <p className="text-xs text-muted-foreground">
                    {t("dailyQuota.current", {
                      currency: currencySymbol,
                      current: currentQuota.dailyCost.current.toFixed(4),
                      limit: currentQuota.dailyCost.limit.toFixed(2),
                    })}
                  </p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="flex-shrink-0 pt-3 border-t">
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
