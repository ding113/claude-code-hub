"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { type MouseEvent, useCallback } from "react";
import { toast } from "sonner";
import { AnthropicEffortBadge } from "@/components/customs/anthropic-effort-badge";
import { ModelVendorIcon } from "@/components/customs/model-vendor-icon";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTokenAmount } from "@/lib/utils";
import { extractReasoningEffortInfo } from "@/lib/utils/anthropic-effort";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import { resolveModelAuditDisplay } from "@/lib/utils/model-audit-display";
import type { SpecialSetting } from "@/types/special-settings";
import type { BillingModelSource } from "@/types/system-config";

interface ModelDisplayWithRedirectProps {
  originalModel: string | null;
  currentModel: string | null;
  actualResponseModel?: string | null;
  billingModelSource: BillingModelSource;
  specialSettings?: SpecialSetting[] | null;
  reasoningOutputTokens?: number | null;
  onRedirectClick?: () => void;
}

export function ModelDisplayWithRedirect({
  originalModel,
  currentModel,
  actualResponseModel = null,
  billingModelSource,
  specialSettings = null,
  reasoningOutputTokens = null,
  onRedirectClick,
}: ModelDisplayWithRedirectProps) {
  const tCommon = useTranslations("common");
  const tAudit = useTranslations("dashboard.logs.details.modelAudit");
  const tDetails = useTranslations("dashboard.logs.details");
  const tTable = useTranslations("dashboard.logs.table");

  const audit = resolveModelAuditDisplay({
    originalModel,
    model: currentModel,
    actualResponseModel,
    billingModelSource,
  });
  const isRedirected = audit.hasRedirect;
  const billingModel = audit.primaryBillingModel;
  const effortInfo = extractReasoningEffortInfo(specialSettings);
  const requestModel = audit.effectiveRequestModel;
  const responseModel = audit.secondaryActualModel;
  const desktopEffortLabel = effortInfo?.hasRequestEffort
    ? tTable("reasoningEffortShort", { effort: effortInfo.originalEffort })
    : effortInfo
      ? tTable("reasoningEffortApplied", { effort: effortInfo.originalEffort })
      : null;
  const mobileEffortLabel = effortInfo?.hasRequestEffort
    ? tTable("reasoningEffortShort", { effort: effortInfo.originalEffort })
    : effortInfo
      ? tTable("reasoningEffortAppliedShort", { effort: effortInfo.originalEffort })
      : null;

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
      <div
        className="hidden items-center gap-1 text-xs text-muted-foreground truncate md:flex"
        aria-label={tAudit("secondaryLineAriaLabel", {
          model: audit.secondaryActualModel,
        })}
      >
        <span aria-hidden>{tAudit("arrowPrefix")}</span>
        <span className="truncate">{audit.secondaryActualModel}</span>
      </div>
    ) : null;

  const modelRows = [
    {
      label: tDetails("modelRedirect.billingModel"),
      value: billingModel || "-",
    },
    requestModel && requestModel !== billingModel
      ? {
          label: tAudit("requestModelLabel"),
          value: requestModel,
        }
      : null,
    responseModel
      ? {
          label: tAudit("responseModelLabel"),
          value: responseModel,
        }
      : null,
  ].filter((row): row is { label: string; value: string } => row !== null);

  const overriddenEffortForDisplay =
    effortInfo?.isOverridden &&
    effortInfo.hasRequestEffort &&
    effortInfo.overriddenEffort &&
    effortInfo.overriddenEffort !== effortInfo.originalEffort
      ? effortInfo.overriddenEffort
      : null;
  const showOverrideTransition = overriddenEffortForDisplay !== null;

  const tooltipContent = (
    <div className="space-y-2 text-xs max-w-xs">
      {modelRows.map((row) => (
        <div key={`${row.label}:${row.value}`} className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">{row.label}</span>
          <span className="break-all">{row.value}</span>
        </div>
      ))}
      {effortInfo ? (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">{tDetails("effort.label")}</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <AnthropicEffortBadge
              effort={effortInfo.originalEffort}
              label={effortInfo.originalEffort}
            />
            {showOverrideTransition ? (
              <>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <AnthropicEffortBadge
                  effort={overriddenEffortForDisplay}
                  label={overriddenEffortForDisplay}
                />
              </>
            ) : null}
          </div>
          <span className="text-muted-foreground">
            {effortInfo.hasRequestEffort
              ? tDetails("effort.tooltip")
              : tDetails("effort.appliedTooltip")}
          </span>
          {effortInfo.isOverridden ? (
            <span className="text-muted-foreground">
              {effortInfo.hasRequestEffort
                ? tDetails("effort.overridden")
                : tDetails("effort.injectedByProvider")}
            </span>
          ) : null}
          <span className="text-muted-foreground">
            {tDetails("billingDetails.reasoningTokens")}: {formatTokenAmount(reasoningOutputTokens)}
          </span>
        </div>
      ) : reasoningOutputTokens != null ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">
            {tDetails("billingDetails.reasoningTokens")}
          </span>
          <span>{formatTokenAmount(reasoningOutputTokens)}</span>
        </div>
      ) : null}
      {audit.hasActualMismatch ? (
        <p className="text-muted-foreground">{tAudit("mismatchTooltip")}</p>
      ) : null}
      {isRedirected ? (
        <p className="text-muted-foreground">
          {tDetails(`modelRedirect.billingDescription_${billingModelSource}`, {
            original: originalModel ?? "-",
            current: currentModel ?? "-",
          })}
        </p>
      ) : null}
    </div>
  );

  const redirectBadge = isRedirected ? (
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
  ) : null;

  const hasMobileMetaRow = Boolean((effortInfo && mobileEffortLabel) || isRedirected);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex w-full max-w-full min-w-0 flex-col gap-0.5 cursor-help">
            <div className="flex w-full min-w-0 items-center gap-1.5">
              {billingModel ? <ModelVendorIcon modelId={billingModel} /> : null}
              <span
                className="min-w-0 flex-1 truncate cursor-pointer hover:underline"
                onClick={handleCopyModel}
              >
                {billingModel || "-"}
              </span>
              {effortInfo && desktopEffortLabel ? (
                <AnthropicEffortBadge
                  effort={effortInfo.originalEffort}
                  label={desktopEffortLabel}
                  className="hidden shrink-0 md:inline-flex"
                />
              ) : null}
              {redirectBadge ? (
                <span className="hidden md:inline-flex">{redirectBadge}</span>
              ) : null}
            </div>
            {hasMobileMetaRow ? (
              <div className="flex min-w-0 items-center gap-1 md:hidden">
                {effortInfo && mobileEffortLabel ? (
                  <AnthropicEffortBadge
                    effort={effortInfo.originalEffort}
                    label={mobileEffortLabel}
                    className="max-w-full shrink-0"
                  />
                ) : null}
                {redirectBadge}
              </div>
            ) : null}
            {secondaryLine}
          </div>
        </TooltipTrigger>
        <TooltipContent variant="popover">{tooltipContent}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
