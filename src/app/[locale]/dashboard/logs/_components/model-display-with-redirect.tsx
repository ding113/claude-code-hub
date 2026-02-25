"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";
import { ModelVendorIcon } from "@/components/customs/model-vendor-icon";
import { Badge } from "@/components/ui/badge";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import type { BillingModelSource } from "@/types/system-config";

interface ModelDisplayWithRedirectProps {
  originalModel: string | null;
  currentModel: string | null;
  billingModelSource: BillingModelSource;
  onRedirectClick?: () => void;
}

export function ModelDisplayWithRedirect({
  originalModel,
  currentModel,
  billingModelSource,
  onRedirectClick,
}: ModelDisplayWithRedirectProps) {
  const t = useTranslations("common");

  // 判断是否发生重定向
  const isRedirected = originalModel && currentModel && originalModel !== currentModel;

  // 根据计费模型来源配置决定显示哪个模型
  const billingModel = billingModelSource === "original" ? originalModel : currentModel;

  const handleCopyModel = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!billingModel) return;
      void copyTextToClipboard(billingModel).then((ok) => {
        if (ok) toast.success(t("copySuccess"));
      });
    },
    [billingModel, t]
  );

  if (!isRedirected) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        {billingModel ? <ModelVendorIcon modelId={billingModel} /> : null}
        <span className="truncate cursor-pointer hover:underline" onClick={handleCopyModel}>
          {billingModel || "-"}
        </span>
      </div>
    );
  }

  // 计费模型 + 重定向标记（只显示图标）
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {billingModel ? <ModelVendorIcon modelId={billingModel} /> : null}
      <span className="truncate cursor-pointer hover:underline" onClick={handleCopyModel}>
        {billingModel}
      </span>
      <Badge
        variant="outline"
        className="cursor-pointer text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300 px-1 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onRedirectClick?.();
        }}
      >
        <ArrowRight className="h-3 w-3" />
      </Badge>
    </div>
  );
}
