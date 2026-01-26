"use client";

import { motion } from "framer-motion";
import { Info, Layers, Route, Scale, Settings, Timer, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TagInput } from "@/components/ui/tag-input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getProviderTypeConfig } from "@/lib/provider-type-utils";
import type {
  CodexParallelToolCallsPreference,
  CodexReasoningEffortPreference,
  CodexReasoningSummaryPreference,
  CodexTextVerbosityPreference,
  ProviderType,
} from "@/types/provider";
import { ModelMultiSelect } from "../../../model-multi-select";
import { ModelRedirectEditor } from "../../../model-redirect-editor";
import { FieldGroup, SectionCard, SmartInputWrapper, ToggleRow } from "../components/section-card";
import { useProviderForm } from "../provider-form-context";

const GROUP_TAG_MAX_TOTAL_LENGTH = 50;

export function RoutingSection() {
  const t = useTranslations("settings.providers.form");
  const tUI = useTranslations("ui.tagInput");
  const { state, dispatch, mode, provider, enableMultiProviderTypes, groupSuggestions } =
    useProviderForm();
  const isEdit = mode === "edit";

  const renderProviderTypeLabel = (type: ProviderType) => {
    switch (type) {
      case "claude":
        return t("providerTypes.claude");
      case "codex":
        return t("providerTypes.codex");
      case "gemini":
        return t("providerTypes.gemini");
      case "openai-compatible":
        return t("providerTypes.openaiCompatible");
      default:
        return type;
    }
  };

  const handleGroupTagChange = (nextTags: string[]) => {
    const serialized = nextTags.join(",");
    if (serialized.length > GROUP_TAG_MAX_TOTAL_LENGTH) {
      toast.error(t("errors.groupTagTooLong", { max: GROUP_TAG_MAX_TOTAL_LENGTH }));
      return;
    }
    dispatch({ type: "SET_GROUP_TAG", payload: nextTags });
  };

  const hasClaudeRedirects = Object.values(state.routing.modelRedirects).some((target) =>
    target.startsWith("claude-")
  );

  const providerTypes: ProviderType[] = ["claude", "codex", "gemini", "openai-compatible"];

  return (
    <TooltipProvider>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.2 }}
        className="space-y-6"
      >
        {/* Provider Type & Group */}
        <SectionCard
          title={t("sections.routing.providerType.label")}
          description={t("sections.routing.providerTypeDesc")}
          icon={Route}
          variant="highlight"
        >
          <div className="space-y-4">
            <SmartInputWrapper label={t("sections.routing.providerType.label")}>
              <Select
                value={state.routing.providerType}
                onValueChange={(value) =>
                  dispatch({ type: "SET_PROVIDER_TYPE", payload: value as ProviderType })
                }
                disabled={state.ui.isPending}
              >
                <SelectTrigger id={isEdit ? "edit-provider-type" : "provider-type"}>
                  <SelectValue placeholder={t("sections.routing.providerType.placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {providerTypes.map((type) => {
                    const typeConfig = getProviderTypeConfig(type);
                    const TypeIcon = typeConfig.icon;
                    const label = renderProviderTypeLabel(type);
                    return (
                      <SelectItem key={type} value={type}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex h-5 w-5 items-center justify-center rounded ${typeConfig.bgColor}`}
                          >
                            <TypeIcon className={`h-3.5 w-3.5 ${typeConfig.iconColor}`} />
                          </span>
                          <span>{label}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {!enableMultiProviderTypes && state.routing.providerType === "openai-compatible" && (
                <p className="text-xs text-amber-600">
                  {t("sections.routing.providerTypeDisabledNote")}
                </p>
              )}
            </SmartInputWrapper>

            <SmartInputWrapper
              label={t("sections.routing.scheduleParams.group.label")}
              description={t("sections.routing.scheduleParams.group.desc")}
            >
              <TagInput
                id={isEdit ? "edit-group" : "group"}
                value={state.routing.groupTag}
                onChange={handleGroupTagChange}
                placeholder={t("sections.routing.scheduleParams.group.placeholder")}
                disabled={state.ui.isPending}
                maxTagLength={GROUP_TAG_MAX_TOTAL_LENGTH}
                suggestions={groupSuggestions}
                onInvalidTag={(_tag, reason) => {
                  const messages: Record<string, string> = {
                    empty: tUI("emptyTag"),
                    duplicate: tUI("duplicateTag"),
                    too_long: tUI("tooLong", { max: GROUP_TAG_MAX_TOTAL_LENGTH }),
                    invalid_format: tUI("invalidFormat"),
                    max_tags: tUI("maxTags"),
                  };
                  toast.error(messages[reason] || reason);
                }}
              />
            </SmartInputWrapper>
          </div>
        </SectionCard>

        {/* Model Configuration */}
        <SectionCard
          title={t("sections.routing.modelWhitelist.title")}
          description={t("sections.routing.modelWhitelist.desc")}
          icon={Layers}
        >
          <div className="space-y-4">
            {/* Model Redirects */}
            <FieldGroup label={t("sections.routing.modelRedirects.label")}>
              <ModelRedirectEditor
                value={state.routing.modelRedirects}
                onChange={(value: Record<string, string>) =>
                  dispatch({ type: "SET_MODEL_REDIRECTS", payload: value })
                }
                disabled={state.ui.isPending}
              />
            </FieldGroup>

            {/* Join Claude Pool */}
            {state.routing.providerType !== "claude" && hasClaudeRedirects && (
              <ToggleRow
                label={t("sections.routing.joinClaudePool.label")}
                description={t("sections.routing.joinClaudePool.desc")}
                icon={Users}
                iconColor="text-blue-500"
              >
                <Switch
                  id={isEdit ? "edit-join-claude-pool" : "join-claude-pool"}
                  checked={state.routing.joinClaudePool}
                  onCheckedChange={(checked) =>
                    dispatch({ type: "SET_JOIN_CLAUDE_POOL", payload: checked })
                  }
                  disabled={state.ui.isPending}
                />
              </ToggleRow>
            )}

            {/* Allowed Models */}
            <FieldGroup label={t("sections.routing.modelWhitelist.label")}>
              <ModelMultiSelect
                providerType={state.routing.providerType}
                selectedModels={state.routing.allowedModels}
                onChange={(value: string[]) =>
                  dispatch({ type: "SET_ALLOWED_MODELS", payload: value })
                }
                disabled={state.ui.isPending}
                providerUrl={state.basic.url}
                apiKey={state.basic.key}
                proxyUrl={state.network.proxyUrl}
                proxyFallbackToDirect={state.network.proxyFallbackToDirect}
                providerId={isEdit ? provider?.id : undefined}
              />
              {state.routing.allowedModels.length > 0 && (
                <div className="flex flex-wrap gap-1 p-2 bg-muted/50 rounded-md">
                  {state.routing.allowedModels.slice(0, 5).map((model) => (
                    <Badge key={model} variant="outline" className="font-mono text-xs">
                      {model}
                    </Badge>
                  ))}
                  {state.routing.allowedModels.length > 5 && (
                    <Badge variant="secondary" className="text-xs">
                      {t("sections.routing.modelWhitelist.moreModels", {
                        count: state.routing.allowedModels.length - 5,
                      })}
                    </Badge>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {state.routing.allowedModels.length === 0 ? (
                  <span className="text-green-600">
                    {t("sections.routing.modelWhitelist.allowAll")}
                  </span>
                ) : (
                  <span>
                    {t("sections.routing.modelWhitelist.selectedOnly", {
                      count: state.routing.allowedModels.length,
                    })}
                  </span>
                )}
              </p>
            </FieldGroup>
          </div>
        </SectionCard>

        {/* Scheduling Parameters */}
        <SectionCard
          title={t("sections.routing.scheduleParams.title")}
          description={t("sections.routing.scheduleParams.priority.desc")}
          icon={Scale}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SmartInputWrapper
              label={t("sections.routing.scheduleParams.priority.label")}
              description={t("sections.routing.scheduleParams.priority.desc")}
            >
              <Input
                id={isEdit ? "edit-priority" : "priority"}
                type="number"
                value={state.routing.priority}
                onChange={(e) =>
                  dispatch({ type: "SET_PRIORITY", payload: parseInt(e.target.value, 10) || 0 })
                }
                placeholder={t("sections.routing.scheduleParams.priority.placeholder")}
                disabled={state.ui.isPending}
                min="0"
                step="1"
              />
            </SmartInputWrapper>

            <SmartInputWrapper
              label={t("sections.routing.scheduleParams.weight.label")}
              description={t("sections.routing.scheduleParams.weight.desc")}
            >
              <Input
                id={isEdit ? "edit-weight" : "weight"}
                type="number"
                value={state.routing.weight}
                onChange={(e) =>
                  dispatch({ type: "SET_WEIGHT", payload: parseInt(e.target.value, 10) || 1 })
                }
                placeholder={t("sections.routing.scheduleParams.weight.placeholder")}
                disabled={state.ui.isPending}
                min="1"
                step="1"
              />
            </SmartInputWrapper>

            <SmartInputWrapper
              label={t("sections.routing.scheduleParams.costMultiplier.label")}
              description={t("sections.routing.scheduleParams.costMultiplier.desc")}
            >
              <Input
                id={isEdit ? "edit-cost" : "cost"}
                type="number"
                value={state.routing.costMultiplier}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "") {
                    dispatch({ type: "SET_COST_MULTIPLIER", payload: 1.0 });
                    return;
                  }
                  const num = parseFloat(value);
                  dispatch({ type: "SET_COST_MULTIPLIER", payload: Number.isNaN(num) ? 1.0 : num });
                }}
                onFocus={(e) => e.target.select()}
                placeholder={t("sections.routing.scheduleParams.costMultiplier.placeholder")}
                disabled={state.ui.isPending}
                min="0"
                step="0.0001"
              />
            </SmartInputWrapper>
          </div>
        </SectionCard>

        {/* Advanced Settings */}
        <SectionCard title={t("sections.routing.preserveClientIp.label")} icon={Settings}>
          <div className="space-y-4">
            <ToggleRow
              label={t("sections.routing.preserveClientIp.label")}
              description={t("sections.routing.preserveClientIp.desc")}
            >
              <Switch
                id={isEdit ? "edit-preserve-client-ip" : "preserve-client-ip"}
                checked={state.routing.preserveClientIp}
                onCheckedChange={(checked) =>
                  dispatch({ type: "SET_PRESERVE_CLIENT_IP", payload: checked })
                }
                disabled={state.ui.isPending}
              />
            </ToggleRow>

            {/* Cache TTL */}
            <SmartInputWrapper
              label={t("sections.routing.cacheTtl.label")}
              description={t("sections.routing.cacheTtl.desc")}
            >
              <Select
                value={state.routing.cacheTtlPreference}
                onValueChange={(val) =>
                  dispatch({
                    type: "SET_CACHE_TTL_PREFERENCE",
                    payload: val as "inherit" | "5m" | "1h",
                  })
                }
                disabled={state.ui.isPending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="inherit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">
                    {t("sections.routing.cacheTtl.options.inherit")}
                  </SelectItem>
                  <SelectItem value="5m">{t("sections.routing.cacheTtl.options.5m")}</SelectItem>
                  <SelectItem value="1h">{t("sections.routing.cacheTtl.options.1h")}</SelectItem>
                </SelectContent>
              </Select>
            </SmartInputWrapper>

            {/* 1M Context Window - Claude type only */}
            {state.routing.providerType === "claude" && (
              <SmartInputWrapper
                label={t("sections.routing.context1m.label")}
                description={t("sections.routing.context1m.desc")}
              >
                <Select
                  value={state.routing.context1mPreference}
                  onValueChange={(val) =>
                    dispatch({
                      type: "SET_CONTEXT_1M_PREFERENCE",
                      payload: val as "inherit" | "force_enable" | "disabled",
                    })
                  }
                  disabled={state.ui.isPending}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="inherit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">
                      {t("sections.routing.context1m.options.inherit")}
                    </SelectItem>
                    <SelectItem value="force_enable">
                      {t("sections.routing.context1m.options.forceEnable")}
                    </SelectItem>
                    <SelectItem value="disabled">
                      {t("sections.routing.context1m.options.disabled")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </SmartInputWrapper>
            )}
          </div>
        </SectionCard>

        {/* Codex Overrides - Codex type only */}
        {state.routing.providerType === "codex" && (
          <SectionCard
            title={t("sections.codexStrategy.title")}
            description={t("sections.codexStrategy.desc")}
            icon={Timer}
          >
            <div className="space-y-4">
              <SmartInputWrapper label={t("sections.routing.codexOverrides.reasoningEffort.label")}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="relative">
                      <Select
                        value={state.routing.codexReasoningEffortPreference}
                        onValueChange={(val) =>
                          dispatch({
                            type: "SET_CODEX_REASONING_EFFORT",
                            payload: val as CodexReasoningEffortPreference,
                          })
                        }
                        disabled={state.ui.isPending}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="inherit" />
                        </SelectTrigger>
                        <SelectContent>
                          {["inherit", "minimal", "low", "medium", "high", "xhigh", "none"].map(
                            (val) => (
                              <SelectItem key={val} value={val}>
                                {t(
                                  `sections.routing.codexOverrides.reasoningEffort.options.${val}`
                                )}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                      <Info className="absolute right-10 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="text-sm">
                      {t("sections.routing.codexOverrides.reasoningEffort.help")}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </SmartInputWrapper>

              <SmartInputWrapper
                label={t("sections.routing.codexOverrides.reasoningSummary.label")}
              >
                <Select
                  value={state.routing.codexReasoningSummaryPreference}
                  onValueChange={(val) =>
                    dispatch({
                      type: "SET_CODEX_REASONING_SUMMARY",
                      payload: val as CodexReasoningSummaryPreference,
                    })
                  }
                  disabled={state.ui.isPending}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="inherit" />
                  </SelectTrigger>
                  <SelectContent>
                    {["inherit", "auto", "detailed"].map((val) => (
                      <SelectItem key={val} value={val}>
                        {t(`sections.routing.codexOverrides.reasoningSummary.options.${val}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SmartInputWrapper>

              <SmartInputWrapper label={t("sections.routing.codexOverrides.textVerbosity.label")}>
                <Select
                  value={state.routing.codexTextVerbosityPreference}
                  onValueChange={(val) =>
                    dispatch({
                      type: "SET_CODEX_TEXT_VERBOSITY",
                      payload: val as CodexTextVerbosityPreference,
                    })
                  }
                  disabled={state.ui.isPending}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="inherit" />
                  </SelectTrigger>
                  <SelectContent>
                    {["inherit", "low", "medium", "high"].map((val) => (
                      <SelectItem key={val} value={val}>
                        {t(`sections.routing.codexOverrides.textVerbosity.options.${val}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SmartInputWrapper>

              <SmartInputWrapper
                label={t("sections.routing.codexOverrides.parallelToolCalls.label")}
              >
                <Select
                  value={state.routing.codexParallelToolCallsPreference}
                  onValueChange={(val) =>
                    dispatch({
                      type: "SET_CODEX_PARALLEL_TOOL_CALLS",
                      payload: val as CodexParallelToolCallsPreference,
                    })
                  }
                  disabled={state.ui.isPending}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="inherit" />
                  </SelectTrigger>
                  <SelectContent>
                    {["inherit", "true", "false"].map((val) => (
                      <SelectItem key={val} value={val}>
                        {t(`sections.routing.codexOverrides.parallelToolCalls.options.${val}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SmartInputWrapper>
            </div>
          </SectionCard>
        )}
      </motion.div>
    </TooltipProvider>
  );
}
