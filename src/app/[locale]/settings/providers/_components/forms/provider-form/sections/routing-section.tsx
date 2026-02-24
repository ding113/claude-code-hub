"use client";

import { motion } from "framer-motion";
import { Info, Layers, Route, Scale, Settings, Timer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClientRestrictionsEditor } from "@/components/form/client-restrictions-editor";
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
  GeminiGoogleSearchPreference,
  ProviderType,
} from "@/types/provider";
import { AdaptiveThinkingEditor } from "../../../adaptive-thinking-editor";
import { ModelMultiSelect } from "../../../model-multi-select";
import { ModelRedirectEditor } from "../../../model-redirect-editor";
import { ThinkingBudgetEditor } from "../../../thinking-budget-editor";
import { FieldGroup, SectionCard, SmartInputWrapper, ToggleRow } from "../components/section-card";
import { useProviderForm } from "../provider-form-context";

const GROUP_TAG_MAX_TOTAL_LENGTH = 50;

export function RoutingSection() {
  const t = useTranslations("settings.providers.form");
  const tBatch = useTranslations("settings.providers.batchEdit");
  const tUI = useTranslations("ui.tagInput");
  const { state, dispatch, mode, provider, enableMultiProviderTypes, groupSuggestions } =
    useProviderForm();
  const isEdit = mode === "edit";
  const isBatch = mode === "batch";
  const { providerType } = state.routing;

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

  const providerTypes: ProviderType[] = ["claude", "codex", "gemini", "openai-compatible"];
  const allowedClients = state.routing.allowedClients;
  const blockedClients = state.routing.blockedClients;
  const hasAnyClientRestrictions = allowedClients.length > 0 || blockedClients.length > 0;
  const [clientRestrictionsEnabled, setClientRestrictionsEnabled] = useState(
    () => hasAnyClientRestrictions
  );

  useEffect(() => {
    if (!hasAnyClientRestrictions) return;
    setClientRestrictionsEnabled(true);
  }, [hasAnyClientRestrictions]);

  const handleClientRestrictionsEnabledChange = (enabled: boolean) => {
    setClientRestrictionsEnabled(enabled);
    if (!enabled) {
      dispatch({ type: "SET_ALLOWED_CLIENTS", payload: [] });
      dispatch({ type: "SET_BLOCKED_CLIENTS", payload: [] });
    }
  };

  return (
    <TooltipProvider>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.2 }}
        className="space-y-6"
      >
        {/* Provider Type & Group - hidden in batch mode */}
        {!isBatch && (
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
                {!enableMultiProviderTypes &&
                  state.routing.providerType === "openai-compatible" && (
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
        )}

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

            {/* Allowed Models */}
            <FieldGroup label={t("sections.routing.modelWhitelist.label")}>
              <div className="space-y-2">
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
              </div>
            </FieldGroup>

            <ToggleRow
              icon={Info}
              label={t("sections.routing.clientRestrictions.toggleLabel")}
              description={t("sections.routing.clientRestrictions.toggleDesc")}
            >
              <Switch
                checked={clientRestrictionsEnabled}
                onCheckedChange={handleClientRestrictionsEnabledChange}
                disabled={state.ui.isPending}
              />
            </ToggleRow>

            {clientRestrictionsEnabled && (
              <div className="space-y-3">
                <div className="space-y-1 rounded-md border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">
                    {t("sections.routing.clientRestrictions.priorityNote")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.routing.clientRestrictions.customHelp")}
                  </p>
                </div>

                <ClientRestrictionsEditor
                  allowed={allowedClients}
                  blocked={blockedClients}
                  onAllowedChange={(next) =>
                    dispatch({ type: "SET_ALLOWED_CLIENTS", payload: next })
                  }
                  onBlockedChange={(next) =>
                    dispatch({ type: "SET_BLOCKED_CLIENTS", payload: next })
                  }
                  disabled={state.ui.isPending}
                  translations={{
                    allowAction: t("sections.routing.clientRestrictions.allowAction"),
                    blockAction: t("sections.routing.clientRestrictions.blockAction"),
                    customAllowedLabel: t("sections.routing.clientRestrictions.customAllowedLabel"),
                    customAllowedPlaceholder: t(
                      "sections.routing.clientRestrictions.customAllowedPlaceholder"
                    ),
                    customBlockedLabel: t("sections.routing.clientRestrictions.customBlockedLabel"),
                    customBlockedPlaceholder: t(
                      "sections.routing.clientRestrictions.customBlockedPlaceholder"
                    ),
                    customHelp: t("sections.routing.clientRestrictions.customHelp"),
                    presetClients: {
                      "claude-code": t(
                        "sections.routing.clientRestrictions.presetClients.claude-code"
                      ),
                      "gemini-cli": t(
                        "sections.routing.clientRestrictions.presetClients.gemini-cli"
                      ),
                      "factory-cli": t(
                        "sections.routing.clientRestrictions.presetClients.factory-cli"
                      ),
                      "codex-cli": t("sections.routing.clientRestrictions.presetClients.codex-cli"),
                    },
                  }}
                  onInvalidTag={(_tag, reason) => {
                    const messages: Record<string, string> = {
                      empty: tUI("emptyTag"),
                      duplicate: tUI("duplicateTag"),
                      too_long: tUI("tooLong", { max: 64 }),
                      invalid_format: tUI("invalidFormat"),
                      max_tags: tUI("maxTags"),
                    };
                    toast.error(messages[reason] || reason);
                  }}
                />
              </div>
            )}
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

          {/* Per-Group Priority Override */}
          {state.routing.groupTag.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="text-sm font-medium">
                {t("sections.routing.scheduleParams.groupPriorities.label")}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("sections.routing.scheduleParams.groupPriorities.desc")}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {state.routing.groupTag.map((group) => (
                  <div key={group} className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs shrink-0">
                      {group}
                    </Badge>
                    <Input
                      type="number"
                      value={state.routing.groupPriorities[group] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        const next = { ...state.routing.groupPriorities };
                        if (val === "") {
                          delete next[group];
                        } else {
                          next[group] = parseInt(val, 10) || 0;
                        }
                        dispatch({ type: "SET_GROUP_PRIORITIES", payload: next });
                      }}
                      placeholder={t("sections.routing.scheduleParams.groupPriorities.placeholder")}
                      disabled={state.ui.isPending}
                      min="0"
                      step="1"
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
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

            {/* Swap Cache TTL Billing */}
            <ToggleRow
              label={t("sections.routing.swapCacheTtlBilling.label")}
              description={t("sections.routing.swapCacheTtlBilling.desc")}
            >
              <Switch
                id={isEdit ? "edit-swap-cache-ttl-billing" : "swap-cache-ttl-billing"}
                checked={state.routing.swapCacheTtlBilling}
                onCheckedChange={(checked) =>
                  dispatch({ type: "SET_SWAP_CACHE_TTL_BILLING", payload: checked })
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

            {/* 1M Context Window - Claude type only (or batch mode) */}
            {(providerType === "claude" || providerType === "claude-auth" || isBatch) && (
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

        {/* Codex Overrides - Codex type only (or batch mode) */}
        {(providerType === "codex" || isBatch) && (
          <SectionCard
            title={t("sections.routing.codexOverrides.title")}
            description={t("sections.routing.codexOverrides.desc")}
            icon={Timer}
            badge={
              isBatch ? (
                <Badge variant="outline">{tBatch("batchNotes.codexOnly")}</Badge>
              ) : undefined
            }
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
                      <Info
                        aria-hidden="true"
                        className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                      />
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

        {/* Anthropic Overrides - Claude type only (or batch mode) */}
        {(providerType === "claude" || providerType === "claude-auth" || isBatch) && (
          <SectionCard
            title={t("sections.routing.anthropicOverrides.maxTokens.label")}
            description={t("sections.routing.anthropicOverrides.maxTokens.help")}
            icon={Timer}
            badge={
              isBatch ? (
                <Badge variant="outline">{tBatch("batchNotes.claudeOnly")}</Badge>
              ) : undefined
            }
          >
            <div className="space-y-4">
              <SmartInputWrapper label={t("sections.routing.anthropicOverrides.maxTokens.label")}>
                <div className="flex gap-2">
                  <Select
                    value={
                      state.routing.anthropicMaxTokensPreference === "inherit"
                        ? "inherit"
                        : "custom"
                    }
                    onValueChange={(val) => {
                      if (val === "inherit") {
                        dispatch({ type: "SET_ANTHROPIC_MAX_TOKENS", payload: "inherit" });
                      } else {
                        dispatch({ type: "SET_ANTHROPIC_MAX_TOKENS", payload: "8192" });
                      }
                    }}
                    disabled={state.ui.isPending}
                  >
                    <SelectTrigger
                      className={
                        state.routing.anthropicMaxTokensPreference === "inherit"
                          ? "flex-1 min-w-0"
                          : "w-40"
                      }
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">
                        {t("sections.routing.anthropicOverrides.maxTokens.options.inherit")}
                      </SelectItem>
                      <SelectItem value="custom">
                        {t("sections.routing.anthropicOverrides.maxTokens.options.custom")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {state.routing.anthropicMaxTokensPreference !== "inherit" && (
                    <Input
                      type="number"
                      value={
                        state.routing.anthropicMaxTokensPreference === "inherit"
                          ? ""
                          : state.routing.anthropicMaxTokensPreference
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "") {
                          dispatch({ type: "SET_ANTHROPIC_MAX_TOKENS", payload: "inherit" });
                        } else {
                          dispatch({ type: "SET_ANTHROPIC_MAX_TOKENS", payload: val });
                        }
                      }}
                      placeholder={t("sections.routing.anthropicOverrides.maxTokens.placeholder")}
                      disabled={state.ui.isPending}
                      min="1"
                      max="64000"
                      className="flex-1"
                    />
                  )}
                </div>
              </SmartInputWrapper>

              <SmartInputWrapper
                label={t("sections.routing.anthropicOverrides.thinkingBudget.label")}
              >
                <ThinkingBudgetEditor
                  value={state.routing.anthropicThinkingBudgetPreference}
                  onChange={(val) =>
                    dispatch({
                      type: "SET_ANTHROPIC_THINKING_BUDGET",
                      payload: val,
                    })
                  }
                  disabled={state.ui.isPending}
                />
              </SmartInputWrapper>

              <AdaptiveThinkingEditor
                enabled={state.routing.anthropicAdaptiveThinking !== null}
                config={
                  state.routing.anthropicAdaptiveThinking || {
                    effort: "medium",
                    modelMatchMode: "all",
                    models: [],
                  }
                }
                onEnabledChange={(enabled) =>
                  dispatch({ type: "SET_ADAPTIVE_THINKING_ENABLED", payload: enabled })
                }
                onConfigChange={(newConfig) => {
                  dispatch({
                    type: "SET_ADAPTIVE_THINKING_EFFORT",
                    payload: newConfig.effort,
                  });
                  dispatch({
                    type: "SET_ADAPTIVE_THINKING_MODEL_MATCH_MODE",
                    payload: newConfig.modelMatchMode,
                  });
                  dispatch({
                    type: "SET_ADAPTIVE_THINKING_MODELS",
                    payload: newConfig.models,
                  });
                }}
                disabled={state.ui.isPending}
              />
            </div>
          </SectionCard>
        )}

        {/* Gemini Overrides - Gemini type only (or batch mode) */}
        {(providerType === "gemini" || providerType === "gemini-cli" || isBatch) && (
          <SectionCard
            title={t("sections.routing.geminiOverrides.title")}
            description={t("sections.routing.geminiOverrides.desc")}
            icon={Settings}
            badge={
              isBatch ? (
                <Badge variant="outline">{tBatch("batchNotes.geminiOnly")}</Badge>
              ) : undefined
            }
          >
            <SmartInputWrapper label={t("sections.routing.geminiOverrides.googleSearch.label")}>
              <Select
                value={state.routing.geminiGoogleSearchPreference}
                onValueChange={(val) =>
                  dispatch({
                    type: "SET_GEMINI_GOOGLE_SEARCH",
                    payload: val as GeminiGoogleSearchPreference,
                  })
                }
                disabled={state.ui.isPending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={t("sections.routing.geminiOverrides.googleSearch.options.inherit")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(["inherit", "enabled", "disabled"] as const).map((val) => (
                    <SelectItem key={val} value={val}>
                      {t(`sections.routing.geminiOverrides.googleSearch.options.${val}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SmartInputWrapper>
          </SectionCard>
        )}
      </motion.div>
    </TooltipProvider>
  );
}
