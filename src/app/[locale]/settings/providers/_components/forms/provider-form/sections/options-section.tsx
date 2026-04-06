"use client";

import { motion } from "framer-motion";
import { Clock, Info, Settings, Timer } from "lucide-react";
import { useTranslations } from "next-intl";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  CodexParallelToolCallsPreference,
  CodexReasoningEffortPreference,
  CodexReasoningSummaryPreference,
  CodexServiceTierPreference,
  CodexTextVerbosityPreference,
  GeminiGoogleSearchPreference,
} from "@/types/provider";
import { AdaptiveThinkingEditor } from "../../../adaptive-thinking-editor";
import { ThinkingBudgetEditor } from "../../../thinking-budget-editor";
import { SectionCard, SmartInputWrapper, ToggleRow } from "../components/section-card";
import { useProviderForm } from "../provider-form-context";

interface OptionsSectionProps {
  subSectionRefs?: {
    activeTime?: (el: HTMLDivElement | null) => void;
  };
}

export function OptionsSection({ subSectionRefs }: OptionsSectionProps) {
  const t = useTranslations("settings.providers.form");
  const tBatch = useTranslations("settings.providers.batchEdit");
  const { state, dispatch, mode } = useProviderForm();
  const isEdit = mode === "edit";
  const isBatch = mode === "batch";
  const providerType = state.routing.providerType;

  return (
    <TooltipProvider>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.2 }}
        className="space-y-6"
      >
        <div className="space-y-6">
          {/* Advanced Settings */}
          <SectionCard
            title={t("sections.routing.options.title")}
            description={t("sections.routing.options.desc")}
            icon={Settings}
            variant="highlight"
          >
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

              <ToggleRow
                label={t("sections.routing.disableSessionReuse.label")}
                description={t("sections.routing.disableSessionReuse.desc")}
              >
                <Switch
                  id={isEdit ? "edit-disable-session-reuse" : "disable-session-reuse"}
                  checked={state.routing.disableSessionReuse}
                  onCheckedChange={(checked) =>
                    dispatch({ type: "SET_DISABLE_SESSION_REUSE", payload: checked })
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
                <SmartInputWrapper
                  label={t("sections.routing.codexOverrides.reasoningEffort.label")}
                >
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

                <SmartInputWrapper label={t("sections.routing.codexOverrides.serviceTier.label")}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="relative">
                        <Select
                          value={state.routing.codexServiceTierPreference}
                          onValueChange={(val) =>
                            dispatch({
                              type: "SET_CODEX_SERVICE_TIER",
                              payload: val as CodexServiceTierPreference,
                            })
                          }
                          disabled={state.ui.isPending}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue
                              placeholder={t(
                                "sections.routing.codexOverrides.serviceTier.options.inherit"
                              )}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {["inherit", "auto", "default", "flex", "priority"].map((val) => (
                              <SelectItem key={val} value={val}>
                                {t(`sections.routing.codexOverrides.serviceTier.options.${val}`)}
                              </SelectItem>
                            ))}
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
                        {t("sections.routing.codexOverrides.serviceTier.help")}
                      </p>
                    </TooltipContent>
                  </Tooltip>
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
                      placeholder={t(
                        "sections.routing.geminiOverrides.googleSearch.options.inherit"
                      )}
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

          {/* Scheduled Active Time */}
          <div ref={subSectionRefs?.activeTime}>
            <SectionCard
              title={t("sections.routing.activeTime.title")}
              description={t("sections.routing.activeTime.description")}
              icon={Clock}
            >
              <div className="space-y-4">
                <ToggleRow
                  label={t("sections.routing.activeTime.toggleLabel")}
                  description={t("sections.routing.activeTime.toggleDescription")}
                >
                  <Switch
                    id={isEdit ? "edit-active-time-toggle" : "active-time-toggle"}
                    checked={
                      state.routing.activeTimeStart !== null && state.routing.activeTimeEnd !== null
                    }
                    onCheckedChange={(checked) => {
                      if (checked) {
                        dispatch({ type: "SET_ACTIVE_TIME_START", payload: "09:00" });
                        dispatch({ type: "SET_ACTIVE_TIME_END", payload: "22:00" });
                      } else {
                        dispatch({ type: "SET_ACTIVE_TIME_START", payload: null });
                        dispatch({ type: "SET_ACTIVE_TIME_END", payload: null });
                      }
                    }}
                    disabled={state.ui.isPending}
                  />
                </ToggleRow>

                {state.routing.activeTimeStart !== null && state.routing.activeTimeEnd !== null && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <SmartInputWrapper label={t("sections.routing.activeTime.startLabel")}>
                        <Input
                          type="time"
                          value={state.routing.activeTimeStart}
                          onChange={(e) =>
                            dispatch({ type: "SET_ACTIVE_TIME_START", payload: e.target.value })
                          }
                          disabled={state.ui.isPending}
                        />
                      </SmartInputWrapper>
                      <SmartInputWrapper label={t("sections.routing.activeTime.endLabel")}>
                        <Input
                          type="time"
                          value={state.routing.activeTimeEnd}
                          onChange={(e) =>
                            dispatch({ type: "SET_ACTIVE_TIME_END", payload: e.target.value })
                          }
                          disabled={state.ui.isPending}
                        />
                      </SmartInputWrapper>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("sections.routing.activeTime.timezoneNote")}
                    </p>
                    {state.routing.activeTimeStart > state.routing.activeTimeEnd && (
                      <p className="text-xs text-amber-600">
                        {t("sections.routing.activeTime.crossDayHint", {
                          start: state.routing.activeTimeStart,
                          end: state.routing.activeTimeEnd,
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </div>
      </motion.div>
    </TooltipProvider>
  );
}
