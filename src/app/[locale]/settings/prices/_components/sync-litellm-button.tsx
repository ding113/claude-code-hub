"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncLiteLLMPrices } from "@/actions/model-prices";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

/**
 * LiteLLM 价格同步按钮组件
 */
export function SyncLiteLLMButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);

    try {
      const response = await syncLiteLLMPrices();

      if (!response.ok) {
        toast.error(response.error || "同步失败");
        return;
      }

      if (!response.data) {
        toast.error("同步成功但未返回处理结果");
        return;
      }

      const { added, updated, unchanged, failed } = response.data;

      // 显示详细结果
      if (added.length > 0 || updated.length > 0) {
        toast.success(
          `同步成功：新增 ${added.length} 个，更新 ${updated.length} 个，未变化 ${unchanged.length} 个`
        );
      } else if (unchanged.length > 0) {
        toast.info(`所有 ${unchanged.length} 个模型价格均为最新`);
      } else {
        toast.warning("未找到支持的模型价格");
      }

      if (failed.length > 0) {
        toast.error(`${failed.length} 个模型处理失败`);
      }

      // 刷新页面数据
      router.refresh();
    } catch (error) {
      console.error("同步失败:", error);
      toast.error("同步失败，请重试");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
      <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
      {syncing ? "同步中..." : "同步 LiteLLM 价格"}
    </Button>
  );
}
