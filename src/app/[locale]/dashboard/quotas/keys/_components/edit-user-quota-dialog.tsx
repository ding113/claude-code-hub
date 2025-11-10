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
import { editUser } from "@/actions/users";
import { toast } from "sonner";
import { type CurrencyCode, CURRENCY_CONFIG } from "@/lib/utils/currency";
import { useTranslations } from "next-intl";

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
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description", { userName })}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* RPM 限制 */}
            <div className="grid gap-2">
              <Label htmlFor="rpmLimit">{t("rpm.label")}</Label>
              <Input
                id="rpmLimit"
                type="number"
                min="1"
                placeholder={t("rpm.placeholder")}
                value={rpmLimit}
                onChange={(e) => setRpmLimit(e.target.value)}
                required
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
            <div className="grid gap-2">
              <Label htmlFor="dailyQuota">{t("dailyQuota.label")}</Label>
              <Input
                id="dailyQuota"
                type="number"
                step="0.01"
                min="0"
                placeholder={t("dailyQuota.placeholder")}
                value={dailyQuota}
                onChange={(e) => setDailyQuota(e.target.value)}
                required
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

          <DialogFooter>
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
