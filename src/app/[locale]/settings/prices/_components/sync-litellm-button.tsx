"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { syncLiteLLMPrices } from "@/actions/model-prices";
import { Button } from "@/components/ui/button";

/**
 * LiteLLM 价格同步按钮组件
 */
export function SyncLiteLLMButton() {
  const t = useTranslations("settings");
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);

    try {
      const response = await syncLiteLLMPrices();

      if (!response.ok) {
        toast.error(response.error || t("prices.sync.failed"));
        return;
      }

      if (!response.data) {
        toast.error(t("prices.sync.failedNoResult"));
        return;
      }

      const { added, updated, unchanged, failed } = response.data;

      // 优先显示失败信息（更明显）
      if (failed.length > 0) {
        toast.error(
          t("prices.sync.partialFailure", { failed: failed.length }) +
            (failed.length <= 5 ? `\n失败模型: ${failed.join(", ")}` : ""),
          {
            duration: 5000, // 失败消息显示更长时间
          }
        );
      }

      // 显示成功信息
      if (added.length > 0 || updated.length > 0) {
        toast.success(
          t("prices.sync.successWithChanges", {
            added: added.length,
            updated: updated.length,
            unchanged: unchanged.length,
          })
        );
      } else if (unchanged.length > 0) {
        toast.info(t("prices.sync.successNoChanges", { unchanged: unchanged.length }));
      } else if (failed.length === 0) {
        toast.warning(t("prices.sync.noModels"));
      }

      // 刷新页面数据
      router.refresh();
    } catch (error) {
      console.error("同步失败:", error);
      toast.error(t("prices.sync.failedError"));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
      <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
      {syncing ? t("prices.sync.syncing") : t("prices.sync.button")}
    </Button>
  );
}
