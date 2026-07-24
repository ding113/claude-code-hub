"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { ThinkingEffortBadge } from "@/components/customs/thinking-effort-badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { extractThinkingEffortInfo } from "@/lib/utils/thinking-effort";
import type { SpecialSetting } from "@/types/special-settings";

/** 思考强度展示属性。 */
interface ThinkingEffortDisplayProps {
  /** 使用记录中的请求参数与供应商覆写审计。 */
  specialSettings: SpecialSetting[] | null | undefined;
}

/**
 * 在使用记录中展示任意模型的思考强度（Codex reasoning.effort 或 Anthropic effort）。
 *
 * 供应商改变强度时同时展示请求值和实际转发值，避免只看到客户端参数而误判上游行为。
 */
export function ThinkingEffortDisplay({ specialSettings }: ThinkingEffortDisplayProps) {
  const t = useTranslations("dashboard.logs.details");
  const effortInfo = extractThinkingEffortInfo(specialSettings);

  if (!effortInfo) {
    return <span className="text-muted-foreground">-</span>;
  }

  const messageNamespace = effortInfo.source === "codex" ? "reasoningEffort" : "effort";
  const showEffectiveBadge = effortInfo.isOverridden && effortInfo.effectiveEffort != null;

  return (
    <TooltipProvider>
      <Tooltip delayDuration={250}>
        <TooltipTrigger asChild>
          <span
            className="inline-flex items-center gap-1 whitespace-nowrap"
            data-slot="thinking-effort"
          >
            {effortInfo.requestedEffort && (
              <ThinkingEffortBadge
                effort={effortInfo.requestedEffort}
                label={effortInfo.requestedEffort}
              />
            )}
            {showEffectiveBadge && effortInfo.requestedEffort && (
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            {showEffectiveBadge && (
              <ThinkingEffortBadge
                effort={effortInfo.effectiveEffort as string}
                label={effortInfo.effectiveEffort as string}
              />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs space-y-1">
          <p className="text-xs">{t(`${messageNamespace}.tooltip`)}</p>
          {effortInfo.isOverridden && (
            <p className="text-xs text-muted-foreground">{t(`${messageNamespace}.overridden`)}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
