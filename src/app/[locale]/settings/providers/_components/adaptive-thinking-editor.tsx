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
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex gap-2 items-center">
                  <Select
                    value={config.effort}
                    onValueChange={(val) =>
                      handleEffortChange(val as AnthropicAdaptiveThinkingEffort)
                    }
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
                  <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-sm">
                  {t("sections.routing.anthropicOverrides.adaptiveThinking.effort.help")}
                </p>
              </TooltipContent>
            </Tooltip>
          </SmartInputWrapper>

          <SmartInputWrapper
            label={t("sections.routing.anthropicOverrides.adaptiveThinking.modelMatchMode.label")}
          >
            <Tooltip>
              <TooltipTrigger asChild>
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
                  <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-sm">
                  {t("sections.routing.anthropicOverrides.adaptiveThinking.modelMatchMode.help")}
                </p>
              </TooltipContent>
            </Tooltip>
          </SmartInputWrapper>

          {config.modelMatchMode === "specific" && (
            <SmartInputWrapper
              label={t("sections.routing.anthropicOverrides.adaptiveThinking.models.label")}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex gap-2 items-center">
                    <TagInput
                      value={config.models}
                      onChange={handleModelsChange}
                      placeholder={t(
                        "sections.routing.anthropicOverrides.adaptiveThinking.models.placeholder"
                      )}
                      disabled={disabled}
                    />
                    <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p className="text-sm">
                    {t("sections.routing.anthropicOverrides.adaptiveThinking.models.help")}
                  </p>
                </TooltipContent>
              </Tooltip>
            </SmartInputWrapper>
          )}
        </div>
      )}
    </div>
  );
}
