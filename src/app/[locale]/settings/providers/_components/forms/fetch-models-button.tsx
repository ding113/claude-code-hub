"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Download, CheckCircle2, XCircle } from "lucide-react";
import { fetchProviderModels, getUnmaskedProviderKey } from "@/actions/providers";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { isValidUrl } from "@/lib/utils/validation";
import type { ProviderType } from "@/types/provider";

interface FetchModelsButtonProps {
  providerUrl: string;
  apiKey: string;
  providerType: ProviderType;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
  disabled?: boolean;
  providerId?: number;
  onModelsLoaded: (models: string[]) => void;
}

type FetchStatus = "idle" | "loading" | "success" | "error";

/**
 * 从 provider API 获取可用模型的 Button 组件
 *
 * 从 provider 的 /models 端点获取模型列表，并通过 onModelsLoaded 
 * callback 将结果传递给父组件。
 */
export function FetchModelsButton({
  providerUrl,
  apiKey,
  providerType,
  proxyUrl,
  proxyFallbackToDirect = false,
  disabled = false,
  providerId,
  onModelsLoaded,
}: FetchModelsButtonProps) {
  const t = useTranslations("settings.providers.form.fetchModels");
  const [status, setStatus] = useState<FetchStatus>("idle");
  const [lastFetchCount, setLastFetchCount] = useState<number>(0);

  const handleFetch = async () => {
    // 验证 URL
    if (!providerUrl.trim()) {
      toast.error(t("fillUrlFirst"));
      return;
    }

    if (!isValidUrl(providerUrl.trim()) || !/^https?:\/\//.test(providerUrl.trim())) {
      toast.error(t("invalidUrl"));
      return;
    }

    setStatus("loading");

    try {
      // 解析 API key：优先使用表单输入，如果提供了 providerId 则回退到数据库
      let resolvedKey = apiKey.trim();

      if (!resolvedKey && providerId) {
        const result = await getUnmaskedProviderKey(providerId);
        if (!result.ok) {
          toast.error(result.error || t("fillKeyFirst"));
          setStatus("error");
          setTimeout(() => setStatus("idle"), 3000);
          return;
        }

        if (!result.data?.key) {
          toast.error(t("fillKeyFirst"));
          setStatus("error");
          setTimeout(() => setStatus("idle"), 3000);
          return;
        }

        resolvedKey = result.data.key;
      }

      if (!resolvedKey) {
        toast.error(t("fillKeyFirst"));
        setStatus("error");
        setTimeout(() => setStatus("idle"), 3000);
        return;
      }

      // 从 provider 获取模型
      const response = await fetchProviderModels({
        providerUrl: providerUrl.trim(),
        apiKey: resolvedKey,
        providerType,
        proxyUrl: proxyUrl?.trim() || null,
        proxyFallbackToDirect,
      });

      if (!response.ok) {
        toast.error(response.error || t("fetchFailed"));
        setStatus("error");
        setTimeout(() => setStatus("idle"), 3000);
        return;
      }

      if (!response.data?.models || response.data.models.length === 0) {
        toast.warning(t("noModelsFound"));
        setStatus("success");
        setLastFetchCount(0);
        setTimeout(() => setStatus("idle"), 3000);
        return;
      }

      const { models } = response.data;
      setLastFetchCount(models.length);
      setStatus("success");

      // 通知父组件
      onModelsLoaded(models);

      toast.success(t("fetchSuccess"), {
        description: t("modelsFound", { count: models.length }),
      });

      // 3 秒后重置状态
      setTimeout(() => {
        setStatus("idle");
      }, 3000);
    } catch (error) {
      console.error("Fetch models failed:", error);
      toast.error(t("fetchFailed"));
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  const getButtonContent = () => {
    switch (status) {
      case "loading":
        return (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t("fetching")}
          </>
        );
      case "success":
        return (
          <>
            <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
            {t("fetchedCount", { count: lastFetchCount })}
          </>
        );
      case "error":
        return (
          <>
            <XCircle className="h-4 w-4 mr-2 text-red-600" />
            {t("fetchFailed")}
          </>
        );
      default:
        return (
          <>
            <Download className="h-4 w-4 mr-2" />
            {t("fetchModels")}
          </>
        );
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleFetch}
      disabled={disabled || status === "loading" || !providerUrl.trim()}
      className="shrink-0"
    >
      {getButtonContent()}
    </Button>
  );
}
