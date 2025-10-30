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

interface KeyQuota {
  cost5h: { current: number; limit: number | null };
  costWeekly: { current: number; limit: number | null };
  costMonthly: { current: number; limit: number | null };
  concurrentSessions: { current: number; limit: number };
}

interface EditKeyQuotaDialogProps {
  keyId: number;
  keyName: string;
  userName: string;
  currentQuota: KeyQuota | null;
  trigger?: React.ReactNode;
}

export function EditKeyQuotaDialog({
  keyId,
  keyName,
  userName,
  currentQuota,
  trigger,
}: EditKeyQuotaDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // 表单状态
  const [limit5h, setLimit5h] = useState<string>(
    currentQuota?.cost5h.limit?.toString() ?? ""
  );
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
          limitWeeklyUsd: limitWeekly ? parseFloat(limitWeekly) : null,
          limitMonthlyUsd: limitMonthly ? parseFloat(limitMonthly) : null,
          limitConcurrentSessions: limitConcurrent ? parseInt(limitConcurrent, 10) : 0,
        });

        if (result.ok) {
          toast.success("限额设置成功");
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

  const handleClearQuota = () => {
    startTransition(async () => {
      try {
        const result = await editKey(keyId, {
          name: keyName,
          limit5hUsd: null,
          limitWeeklyUsd: null,
          limitMonthlyUsd: null,
          limitConcurrentSessions: 0,
        });

        if (result.ok) {
          toast.success("限额已清除");
          setOpen(false);
          router.refresh();
        } else {
          toast.error(result.error || "清除失败");
        }
      } catch (error) {
        toast.error("清除失败，请稍后重试");
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
            <span className="ml-2">设置限额</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>设置密钥限额</DialogTitle>
            <DialogDescription>
              密钥: {keyName} ({userName})
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* 5小时限额 */}
            <div className="grid gap-2">
              <Label htmlFor="limit5h">5小时限额（USD）</Label>
              <Input
                id="limit5h"
                type="number"
                step="0.01"
                min="0"
                placeholder="不限制"
                value={limit5h}
                onChange={(e) => setLimit5h(e.target.value)}
              />
              {currentQuota?.cost5h.limit && (
                <p className="text-xs text-muted-foreground">
                  当前已用: ${currentQuota.cost5h.current.toFixed(4)} / $
                  {currentQuota.cost5h.limit.toFixed(2)}
                </p>
              )}
            </div>

            {/* 周限额 */}
            <div className="grid gap-2">
              <Label htmlFor="limitWeekly">周限额（USD）</Label>
              <Input
                id="limitWeekly"
                type="number"
                step="0.01"
                min="0"
                placeholder="不限制"
                value={limitWeekly}
                onChange={(e) => setLimitWeekly(e.target.value)}
              />
              {currentQuota?.costWeekly.limit && (
                <p className="text-xs text-muted-foreground">
                  当前已用: ${currentQuota.costWeekly.current.toFixed(4)} / $
                  {currentQuota.costWeekly.limit.toFixed(2)}
                </p>
              )}
            </div>

            {/* 月限额 */}
            <div className="grid gap-2">
              <Label htmlFor="limitMonthly">月限额（USD）</Label>
              <Input
                id="limitMonthly"
                type="number"
                step="0.01"
                min="0"
                placeholder="不限制"
                value={limitMonthly}
                onChange={(e) => setLimitMonthly(e.target.value)}
              />
              {currentQuota?.costMonthly.limit && (
                <p className="text-xs text-muted-foreground">
                  当前已用: ${currentQuota.costMonthly.current.toFixed(4)} / $
                  {currentQuota.costMonthly.limit.toFixed(2)}
                </p>
              )}
            </div>

            {/* 并发限额 */}
            <div className="grid gap-2">
              <Label htmlFor="limitConcurrent">并发 Session 限额</Label>
              <Input
                id="limitConcurrent"
                type="number"
                min="0"
                placeholder="0 = 不限制"
                value={limitConcurrent}
                onChange={(e) => setLimitConcurrent(e.target.value)}
              />
              {currentQuota && currentQuota.concurrentSessions.limit > 0 && (
                <p className="text-xs text-muted-foreground">
                  当前并发: {currentQuota.concurrentSessions.current} /{" "}
                  {currentQuota.concurrentSessions.limit}
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
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
                清除所有限额
              </Button>
            )}
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
