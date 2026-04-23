"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { type MouseEvent, useCallback } from "react";
import { toast } from "sonner";
import { ModelVendorIcon } from "@/components/customs/model-vendor-icon";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import { resolveModelAuditDisplay } from "@/lib/utils/model-audit-display";
import type { BillingModelSource } from "@/types/system-config";

interface ModelDisplayWithRedirectProps {
  originalModel: string | null;
  currentModel: string | null;
  actualResponseModel?: string | null;
  billingModelSource: BillingModelSource;
  onRedirectClick?: () => void;
}

export function ModelDisplayWithRedirect({
  originalModel,
  currentModel,
  actualResponseModel = null,
  billingModelSource,
  onRedirectClick,
}: ModelDisplayWithRedirectProps) {
  const tCommon = useTranslations("common");
  const tAudit = useTranslations("dashboard.logs.details.modelAudit");

  const audit = resolveModelAuditDisplay({
    originalModel,
    model: currentModel,
    actualResponseModel,
    billingModelSource,
  });
  const isRedirected = audit.hasRedirect;
  const billingModel = billingModelSource === "original" ? originalModel : currentModel;

  const handleCopyModel = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (!billingModel) return;
      void copyTextToClipboard(billingModel).then((ok) => {
        if (ok) toast.success(tCommon("copySuccess"));
      });
    },
    [billingModel, tCommon]
  );

  const secondaryLine =
    audit.hasActualMismatch && audit.secondaryActualModel ? (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="flex items-center gap-1 text-xs text-muted-foreground truncate cursor-help"
              aria-label={tAudit("secondaryLineAriaLabel", {
                model: audit.secondaryActualModel,
              })}
            >
              <span aria-hidden>{tAudit("arrowPrefix")}</span>
              <span className="truncate">{audit.secondaryActualModel}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs max-w-xs">{tAudit("mismatchTooltip")}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : null;

  if (!isRedirected) {
    return (
      <div className="flex flex-col min-w-0 gap-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {billingModel ? <ModelVendorIcon modelId={billingModel} /> : null}
          <span
            className="truncate max-w-full cursor-pointer hover:underline"
            onClick={handleCopyModel}
          >
            {billingModel || "-"}
          </span>
        </div>
        {secondaryLine}
      </div>
    );
  }

  // 计费模型 + 重定向标记（只显示图标）
  return (
    <div className="flex flex-col min-w-0 gap-0.5">
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
      {secondaryLine}
    </div>
  );
}
