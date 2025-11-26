"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowRight } from "lucide-react";
import type { BillingModelSource } from "@/types/system-config";

interface ModelDisplayWithRedirectProps {
  originalModel: string | null;
  currentModel: string | null;
  billingModelSource: BillingModelSource;
}

export function ModelDisplayWithRedirect({
  originalModel,
  currentModel,
  billingModelSource,
}: ModelDisplayWithRedirectProps) {
  const t = useTranslations("dashboard");

  // 判断是否发生重定向
  const isRedirected =
    originalModel && currentModel && originalModel !== currentModel;

  // 根据计费模型来源配置决定显示哪个模型
  const billingModel = billingModelSource === "original" ? originalModel : currentModel;
  const otherModel = billingModelSource === "original" ? currentModel : originalModel;

  if (!isRedirected) {
    return <span className="truncate">{billingModel || "-"}</span>;
  }

  // 计费模型 + 重定向标记
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="truncate">{billingModel}</span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="cursor-help text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300"
            >
              <ArrowRight className="h-3 w-3 mr-1" />
              {t("logs.modelRedirect.redirected")}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs space-y-1">
              <div>
                <span className="font-medium">
                  {billingModelSource === "original"
                    ? t("logs.details.modelRedirect.actualModelTooltip")
                    : t("logs.details.modelRedirect.originalModelTooltip")}:
                </span>{" "}
                {otherModel}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
