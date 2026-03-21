"use client";

import { motion } from "framer-motion";
import { Info, Layers, Route, Scale } from "lucide-react";
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
import { getProviderTypeConfig } from "@/lib/provider-type-utils";
import type { ProviderType } from "@/types/provider";
import { MixedValueIndicator } from "../../../batch-edit/mixed-value-indicator";
import { ModelMultiSelect } from "../../../model-multi-select";
import { ModelRedirectEditor } from "../../../model-redirect-editor";
import { FieldGroup, SectionCard, SmartInputWrapper, ToggleRow } from "../components/section-card";
import { useProviderForm } from "../provider-form-context";

const GROUP_TAG_MAX_TOTAL_LENGTH = 255;

interface RoutingSectionProps {
  subSectionRefs?: {
    scheduling?: (el: HTMLDivElement | null) => void;
  };
}

export function RoutingSection({ subSectionRefs }: RoutingSectionProps) {
  const t = useTranslations("settings.providers.form");
  const tUI = useTranslations("ui.tagInput");
  const {
    state,
    dispatch,
    mode,
    provider,
    enableMultiProviderTypes,
    groupSuggestions,
    batchAnalysis,
  } = useProviderForm();
  const isEdit = mode === "edit";
  const isBatch = mode === "batch";

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
                maxTagLength={50}
                suggestions={groupSuggestions}
                validateTag={() => true}
                onInvalidTag={(_tag, reason) => {
                  const messages: Record<string, string> = {
                    empty: tUI("emptyTag"),
                    duplicate: tUI("duplicateTag"),
                    too_long: tUI("tooLong", { max: 50 }),
                    invalid_format: tUI("invalidFormat"),
                    max_tags: tUI("maxTags"),
                  };
                  toast.error(messages[reason] || tUI("unknownError"));
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
            <div className="space-y-2">
              <ModelRedirectEditor
                value={state.routing.modelRedirects}
                onChange={(value: Record<string, string>) =>
                  dispatch({ type: "SET_MODEL_REDIRECTS", payload: value })
                }
                disabled={state.ui.isPending}
              />
              {isBatch && batchAnalysis?.routing.modelRedirects.status === "mixed" && (
                <MixedValueIndicator values={batchAnalysis.routing.modelRedirects.values} />
              )}
            </div>
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
                onAllowedChange={(next) => dispatch({ type: "SET_ALLOWED_CLIENTS", payload: next })}
                onBlockedChange={(next) => dispatch({ type: "SET_BLOCKED_CLIENTS", payload: next })}
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
                    "gemini-cli": t("sections.routing.clientRestrictions.presetClients.gemini-cli"),
                    "factory-cli": t(
                      "sections.routing.clientRestrictions.presetClients.factory-cli"
                    ),
                    "codex-cli": t("sections.routing.clientRestrictions.presetClients.codex-cli"),
                  },
                  subClients: {
                    all: t("sections.routing.clientRestrictions.subClients.all"),
                    cli: t("sections.routing.clientRestrictions.subClients.cli"),
                    vscode: t("sections.routing.clientRestrictions.subClients.vscode"),
                    "sdk-ts": t("sections.routing.clientRestrictions.subClients.sdk-ts"),
                    "sdk-py": t("sections.routing.clientRestrictions.subClients.sdk-py"),
                    "cli-sdk": t("sections.routing.clientRestrictions.subClients.cli-sdk"),
                    "gh-action": t("sections.routing.clientRestrictions.subClients.gh-action"),
                    "codex-cli-core": t(
                      "sections.routing.clientRestrictions.subClients.codex-cli-core"
                    ),
                    desktop: t("sections.routing.clientRestrictions.subClients.desktop"),
                    exec: t("sections.routing.clientRestrictions.subClients.exec"),
                  },
                  nSelected: t("sections.routing.clientRestrictions.nSelected", {
                    count: "{count}",
                  }),
                }}
                onInvalidTag={(_tag, reason) => {
                  const messages: Record<string, string> = {
                    empty: tUI("emptyTag"),
                    duplicate: tUI("duplicateTag"),
                    too_long: tUI("tooLong", { max: 64 }),
                    invalid_format: tUI("invalidFormat"),
                    max_tags: tUI("maxTags"),
                  };
                  toast.error(messages[reason] || tUI("unknownError"));
                }}
              />
            </div>
          )}
        </div>
      </SectionCard>

      {/* Scheduling Parameters */}
      <div ref={subSectionRefs?.scheduling}>
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
              <div className="space-y-2">
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
                {isBatch && batchAnalysis?.routing.priority.status === "mixed" && (
                  <MixedValueIndicator values={batchAnalysis.routing.priority.values} />
                )}
              </div>
            </SmartInputWrapper>

            <SmartInputWrapper
              label={t("sections.routing.scheduleParams.weight.label")}
              description={t("sections.routing.scheduleParams.weight.desc")}
            >
              <div className="space-y-2">
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
                {isBatch && batchAnalysis?.routing.weight.status === "mixed" && (
                  <MixedValueIndicator values={batchAnalysis.routing.weight.values} />
                )}
              </div>
            </SmartInputWrapper>

            <SmartInputWrapper
              label={t("sections.routing.scheduleParams.costMultiplier.label")}
              description={t("sections.routing.scheduleParams.costMultiplier.desc")}
            >
              <div className="space-y-2">
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
                    dispatch({
                      type: "SET_COST_MULTIPLIER",
                      payload: Number.isNaN(num) ? 1.0 : num,
                    });
                  }}
                  onFocus={(e) => e.target.select()}
                  placeholder={t("sections.routing.scheduleParams.costMultiplier.placeholder")}
                  disabled={state.ui.isPending}
                  min="0"
                  step="0.0001"
                />
                {isBatch && batchAnalysis?.routing.costMultiplier.status === "mixed" && (
                  <MixedValueIndicator values={batchAnalysis.routing.costMultiplier.values} />
                )}
              </div>
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
      </div>
    </motion.div>
  );
}
