"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSyncLitellm, useSyncLitellmCheck } from "@/lib/api-client/v1/model-prices/hooks";
import type { SyncConflict } from "@/types/model-price";
import { SyncConflictDialog } from "./sync-conflict-dialog";

/**
 * 云端价格表同步按钮组件
 */
export function SyncLiteLLMButton() {
  const t = useTranslations("settings");
  const syncMutation = useSyncLitellm();
  const checkMutation = useSyncLitellmCheck();
  const syncing = syncMutation.isPending;
  const checking = checkMutation.isPending;

  // 冲突弹窗状态
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);

  /**
   * 执行同步（可选覆盖列表）
   */
  const doSync = async (overwriteManual?: string[]) => {
    try {
      const data = await syncMutation.mutateAsync(
        overwriteManual ? { overwriteManual } : undefined
      );

      if (!data) {
        toast.error(t("prices.sync.failedNoResult"));
        return;
      }

      const { added, updated, unchanged, failed, skippedConflicts } = data;

      // 优先显示失败信息（更明显）
      if (failed.length > 0) {
        toast.error(
          t("prices.sync.partialFailure", { failed: failed.length }) +
            (failed.length <= 5
              ? `\n${t("prices.sync.failedModels", { models: failed.join(", ") })}`
              : ""),
          {
            duration: 5000, // 失败消息显示更长时间
          }
        );
      }

      // 显示成功信息
      if (added.length > 0 || updated.length > 0) {
        let message = t("prices.sync.successWithChanges", {
          added: added.length,
          updated: updated.length,
          unchanged: unchanged.length,
        });
        // 如果有跳过的冲突，追加提示
        if (skippedConflicts && skippedConflicts.length > 0) {
          message += ` (${t("prices.sync.skippedConflicts", { count: skippedConflicts.length })})`;
        }
        toast.success(message);
      } else if (unchanged.length > 0) {
        toast.info(t("prices.sync.successNoChanges", { unchanged: unchanged.length }));
      } else if (failed.length === 0) {
        toast.warning(t("prices.sync.noModels"));
      }

      window.dispatchEvent(new Event("price-data-updated"));
    } catch (error) {
      console.error("云端价格表同步失败:", error);
      toast.error(t("prices.sync.failed"));
    }
  };

  /**
   * 处理同步按钮点击 - 先检查冲突
   */
  const handleSync = async () => {
    try {
      // 先检查是否有冲突
      const checkData = await checkMutation.mutateAsync();

      if (checkData?.hasConflicts && checkData.conflicts.length > 0) {
        // 有冲突，显示弹窗
        setConflicts(checkData.conflicts);
        setConflictDialogOpen(true);
      } else {
        // 无冲突，直接同步
        await doSync();
      }
    } catch (error) {
      console.error("云端价格表冲突检查失败:", error);
      toast.error(t("prices.sync.failed"));
    }
  };

  /**
   * 处理冲突弹窗确认
   */
  const handleConflictConfirm = async (selectedModels: string[]) => {
    setConflictDialogOpen(false);
    // 执行同步，传入要覆盖的模型列表
    await doSync(selectedModels);
  };

  const isLoading = syncing || checking;

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleSync} disabled={isLoading}>
        <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
        {checking
          ? t("prices.sync.checking")
          : syncing
            ? t("prices.sync.syncing")
            : t("prices.sync.button")}
      </Button>

      <SyncConflictDialog
        open={conflictDialogOpen}
        onOpenChange={setConflictDialogOpen}
        conflicts={conflicts}
        onConfirm={handleConflictConfirm}
        isLoading={syncing}
      />
    </>
  );
}
