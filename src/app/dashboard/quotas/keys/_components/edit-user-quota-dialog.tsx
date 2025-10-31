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

  const currencySymbol = CURRENCY_CONFIG[currencyCode].symbol;

  // 表单状态
  const [rpmLimit, setRpmLimit] = useState<string>(
    currentQuota?.rpm.limit?.toString() ?? "60"
  );
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
          toast.success("用户限额设置成功");
          setOpen(false);
          router.refresh();
        } else {
          toast.error(result.error || "设置失败");
        }
      } catch (error) {
        toast.error("设置失败，请稍后重试");
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
            <span className="ml-2">编辑限额</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>设置用户限额</DialogTitle>
            <DialogDescription>
              用户: {userName}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* RPM 限制 */}
            <div className="grid gap-2">
              <Label htmlFor="rpmLimit">每分钟请求数 (RPM)</Label>
              <Input
                id="rpmLimit"
                type="number"
                min="1"
                placeholder="60"
                value={rpmLimit}
                onChange={(e) => setRpmLimit(e.target.value)}
                required
              />
              {currentQuota && (
                <p className="text-xs text-muted-foreground">
                  当前: {currentQuota.rpm.current} / {currentQuota.rpm.limit} 请求/分钟
                </p>
              )}
            </div>

            {/* 每日消费限额 */}
            <div className="grid gap-2">
              <Label htmlFor="dailyQuota">每日消费限额（USD）</Label>
              <Input
                id="dailyQuota"
                type="number"
                step="0.01"
                min="0"
                placeholder="100"
                value={dailyQuota}
                onChange={(e) => setDailyQuota(e.target.value)}
                required
              />
              {currentQuota && (
                <p className="text-xs text-muted-foreground">
                  今日已用: {currencySymbol}
                  {currentQuota.dailyCost.current.toFixed(4)} / {currencySymbol}
                  {currentQuota.dailyCost.limit.toFixed(2)}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
