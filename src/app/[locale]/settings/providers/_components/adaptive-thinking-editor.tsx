"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TagInput } from "@/components/ui/tag-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  AnthropicAdaptiveThinkingConfig,
  AnthropicAdaptiveThinkingEffort,
  AnthropicAdaptiveThinkingModelMatchMode,
} from "@/types/provider";
import { SmartInputWrapper, ToggleRow } from "./forms/provider-form/components/section-card";

interface AdaptiveThinkingEditorProps {
  enabled: boolean;
  config: AnthropicAdaptiveThinkingConfig;
  onEnabledChange: (enabled: boolean) => void;
  onConfigChange: (config: AnthropicAdaptiveThinkingConfig) => void;
  disabled?: boolean;
}

export function AdaptiveThinkingEditor({
  enabled,
  config,
  onEnabledChange,
  onConfigChange,
  disabled = false,
}: AdaptiveThinkingEditorProps) {
  const t = useTranslations("settings.providers.form");

  const handleEffortChange = (effort: AnthropicAdaptiveThinkingEffort) => {
    onConfigChange({
      ...config,
      effort,
    });
  };

  const handleModeChange = (modelMatchMode: AnthropicAdaptiveThinkingModelMatchMode) => {
    onConfigChange({
      ...config,
      modelMatchMode,
    });
  };

  const handleModelsChange = (models: string[]) => {
    onConfigChange({
      ...config,
      models,
    });
  };

  return (
    <div className="space-y-4">
      <ToggleRow
        label={t("sections.routing.anthropicOverrides.adaptiveThinking.label")}
        description={t("sections.routing.anthropicOverrides.adaptiveThinking.help")}
      >
        <Switch checked={enabled} onCheckedChange={onEnabledChange} disabled={disabled} />
      </ToggleRow>

      {enabled && (
        <div className="ml-4 space-y-3 border-l-2 border-primary/20 pl-4">
          <SmartInputWrapper
            label={t("sections.routing.anthropicOverrides.adaptiveThinking.effort.label")}
          >
            <div className="flex gap-2 items-center">
              <Select
                value={config.effort}
                onValueChange={(val) => handleEffortChange(val as AnthropicAdaptiveThinkingEffort)}
                disabled={disabled}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["low", "medium", "high", "max"] as const).map((level) => (
                    <SelectItem key={level} value={level}>
                      {t(
                        `sections.routing.anthropicOverrides.adaptiveThinking.effort.options.${level}`
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t(
                      "sections.routing.anthropicOverrides.adaptiveThinking.effort.help"
                    )}
                    className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <Info className="h-4 w-4 shrink-0" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={4} className="max-w-xs">
                  <p className="leading-relaxed">
                    {t("sections.routing.anthropicOverrides.adaptiveThinking.effort.help")}
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          </SmartInputWrapper>

          <SmartInputWrapper
            label={t("sections.routing.anthropicOverrides.adaptiveThinking.modelMatchMode.label")}
          >
            <div className="flex gap-2 items-center">
              <Select
                value={config.modelMatchMode}
                onValueChange={(val) =>
                  handleModeChange(val as AnthropicAdaptiveThinkingModelMatchMode)
                }
                disabled={disabled}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t(
                      "sections.routing.anthropicOverrides.adaptiveThinking.modelMatchMode.options.all"
                    )}
                  </SelectItem>
                  <SelectItem value="specific">
                    {t(
                      "sections.routing.anthropicOverrides.adaptiveThinking.modelMatchMode.options.specific"
                    )}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t(
                      "sections.routing.anthropicOverrides.adaptiveThinking.modelMatchMode.help"
                    )}
                    className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <Info className="h-4 w-4 shrink-0" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={4} className="max-w-xs">
                  <p className="leading-relaxed">
                    {t("sections.routing.anthropicOverrides.adaptiveThinking.modelMatchMode.help")}
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          </SmartInputWrapper>

          {config.modelMatchMode === "specific" && (
            <SmartInputWrapper
              label={t("sections.routing.anthropicOverrides.adaptiveThinking.models.label")}
            >
              <div className="flex gap-2 items-center">
                <TagInput
                  value={config.models}
                  onChange={handleModelsChange}
                  placeholder={t(
                    "sections.routing.anthropicOverrides.adaptiveThinking.models.placeholder"
                  )}
                  disabled={disabled}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t(
                        "sections.routing.anthropicOverrides.adaptiveThinking.models.help"
                      )}
                      className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <Info className="h-4 w-4 shrink-0" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={4} className="max-w-xs">
                    <p className="leading-relaxed">
                      {t("sections.routing.anthropicOverrides.adaptiveThinking.models.help")}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </SmartInputWrapper>
          )}
        </div>
      )}
    </div>
  );
}
