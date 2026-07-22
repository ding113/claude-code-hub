"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { ThinkingEffortBadge } from "@/components/customs/thinking-effort-badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { extractCodexReasoningEffortInfo } from "@/lib/utils/codex-reasoning-effort";
import type { SpecialSetting } from "@/types/special-settings";

/** Codex 思考强度展示属性。 */
interface CodexReasoningEffortDisplayProps {
  /** 使用记录中的请求参数与供应商覆写审计。 */
  specialSettings: SpecialSetting[] | null | undefined;
}

/**
 * 在使用记录中展示 Codex reasoning.effort。
 *
 * 供应商改变强度时同时展示请求值和实际转发值，避免只看到客户端参数而误判上游行为。
 */
export function CodexReasoningEffortDisplay({ specialSettings }: CodexReasoningEffortDisplayProps) {
  const t = useTranslations("dashboard.logs.details.reasoningEffort");
  const effortInfo = extractCodexReasoningEffortInfo(specialSettings);

  if (!effortInfo) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <TooltipProvider>
      <Tooltip delayDuration={250}>
        <TooltipTrigger asChild>
          <span
            className="inline-flex items-center gap-1 whitespace-nowrap"
            data-slot="codex-reasoning-effort"
          >
            {effortInfo.requestedEffort && (
              <ThinkingEffortBadge
                effort={effortInfo.requestedEffort}
                label={effortInfo.requestedEffort}
              />
            )}
            {effortInfo.isOverridden && effortInfo.requestedEffort && (
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            {effortInfo.isOverridden && (
              <ThinkingEffortBadge
                effort={effortInfo.effectiveEffort}
                label={effortInfo.effectiveEffort}
              />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs space-y-1">
          <p className="text-xs">{t("tooltip")}</p>
          {effortInfo.isOverridden && (
            <p className="text-xs text-muted-foreground">{t("overridden")}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
