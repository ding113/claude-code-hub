"use client";

import { motion } from "framer-motion";
import { Clock, Globe, Network, Shield, Timer, Wifi } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PROVIDER_TIMEOUT_DEFAULTS } from "@/lib/constants/provider.constants";
import { cn } from "@/lib/utils";
import { ProxyTestButton } from "../../proxy-test-button";
import { FieldGroup, SectionCard, SmartInputWrapper, ToggleRow } from "../components/section-card";
import { useProviderForm } from "../provider-form-context";

// Timeout input component with visual indicator
interface TimeoutInputProps {
  id: string;
  label: string;
  description: string;
  value: number | undefined;
  defaultValue: number;
  placeholder: string;
  onChange: (value: number | undefined) => void;
  disabled?: boolean;
  min?: string;
  max?: string;
  icon: React.ElementType;
  isCore?: boolean;
}

function TimeoutInput({
  id,
  label,
  description,
  value,
  defaultValue,
  placeholder,
  onChange,
  disabled,
  min = "0",
  max,
  icon: Icon,
  isCore,
}: TimeoutInputProps) {
  const t = useTranslations("settings.providers.form");
  const _displayValue = value ?? defaultValue;
  const isCustom = value !== undefined;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card/50 p-4",
        "transition-all duration-200 hover:border-border",
        isCustom && "border-primary/30"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex items-center justify-center w-10 h-10 rounded-lg shrink-0",
            isCore ? "bg-orange-500/10 text-orange-500" : "bg-muted text-muted-foreground"
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <label htmlFor={id} className="text-sm font-medium text-foreground">
              {label}
            </label>
            {isCore && (
              <span className="text-orange-500 text-[10px] font-medium px-1.5 py-0.5 bg-orange-50 dark:bg-orange-950 rounded border border-orange-200 dark:border-orange-800">
                {t("common.core")}
              </span>
            )}
          </div>
          <div className="relative">
            <Input
              id={id}
              type="number"
              value={value ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                onChange(val === "" ? undefined : parseInt(val, 10));
              }}
              placeholder={placeholder}
              disabled={disabled}
              min={min}
              max={max}
              step="1"
              className={cn(
                "pr-8 font-mono",
                isCore && "border-orange-200 focus:border-orange-500"
              )}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              s
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {isCustom && (
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/50 origin-left"
        />
      )}
    </div>
  );
}

export function NetworkSection() {
  const t = useTranslations("settings.providers.form");
  const { state, dispatch, mode } = useProviderForm();
  const isEdit = mode === "edit";

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      {/* Proxy Configuration */}
      <SectionCard
        title={t("sections.proxy.title")}
        description={t("sections.proxy.desc")}
        icon={Globe}
        variant="highlight"
      >
        <div className="space-y-4">
          <SmartInputWrapper
            label={t("sections.proxy.url.label")}
            description={t("sections.proxy.url.formats")}
          >
            <div className="relative">
              <Input
                id={isEdit ? "edit-proxy-url" : "proxy-url"}
                value={state.network.proxyUrl}
                onChange={(e) => dispatch({ type: "SET_PROXY_URL", payload: e.target.value })}
                placeholder={t("sections.proxy.url.placeholder")}
                disabled={state.ui.isPending}
                className="pr-10 font-mono text-sm"
              />
              <Network className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </SmartInputWrapper>

          {state.network.proxyUrl && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4"
            >
              <ToggleRow
                label={t("sections.proxy.fallback.label")}
                description={t("sections.proxy.fallback.desc")}
                icon={Shield}
                iconColor="text-blue-500"
              >
                <Switch
                  id={isEdit ? "edit-proxy-fallback" : "proxy-fallback"}
                  checked={state.network.proxyFallbackToDirect}
                  onCheckedChange={(checked) =>
                    dispatch({ type: "SET_PROXY_FALLBACK_TO_DIRECT", payload: checked })
                  }
                  disabled={state.ui.isPending}
                />
              </ToggleRow>

              {/* Proxy Test */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
                <div className="flex items-center gap-3">
                  <Wifi className="h-4 w-4 text-primary" />
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">{t("sections.proxy.test.label")}</div>
                    <p className="text-xs text-muted-foreground">{t("sections.proxy.test.desc")}</p>
                  </div>
                </div>
                <ProxyTestButton
                  providerUrl={state.basic.url}
                  proxyUrl={state.network.proxyUrl}
                  proxyFallbackToDirect={state.network.proxyFallbackToDirect}
                  disabled={state.ui.isPending || !state.basic.url.trim()}
                />
              </div>
            </motion.div>
          )}
        </div>
      </SectionCard>

      {/* Timeout Configuration */}
      <SectionCard
        title={t("sections.timeout.title")}
        description={t("sections.timeout.desc")}
        icon={Timer}
      >
        <div className="space-y-4">
          <FieldGroup>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <TimeoutInput
                id={isEdit ? "edit-first-byte-timeout" : "first-byte-timeout"}
                label={t("sections.timeout.streamingFirstByte.label")}
                description={t("sections.timeout.streamingFirstByte.desc")}
                value={state.network.firstByteTimeoutStreamingSeconds}
                defaultValue={PROVIDER_TIMEOUT_DEFAULTS.FIRST_BYTE_TIMEOUT_STREAMING_MS / 1000}
                placeholder={t("sections.timeout.streamingFirstByte.placeholder")}
                onChange={(value) =>
                  dispatch({ type: "SET_FIRST_BYTE_TIMEOUT_STREAMING", payload: value })
                }
                disabled={state.ui.isPending}
                min="0"
                max="180"
                icon={Clock}
                isCore={true}
              />

              <TimeoutInput
                id={isEdit ? "edit-streaming-idle" : "streaming-idle"}
                label={t("sections.timeout.streamingIdle.label")}
                description={t("sections.timeout.streamingIdle.desc")}
                value={state.network.streamingIdleTimeoutSeconds}
                defaultValue={PROVIDER_TIMEOUT_DEFAULTS.STREAMING_IDLE_TIMEOUT_MS / 1000}
                placeholder={t("sections.timeout.streamingIdle.placeholder")}
                onChange={(value) =>
                  dispatch({ type: "SET_STREAMING_IDLE_TIMEOUT", payload: value })
                }
                disabled={state.ui.isPending}
                min="0"
                max="600"
                icon={Timer}
                isCore={true}
              />

              <TimeoutInput
                id={isEdit ? "edit-non-streaming-timeout" : "non-streaming-timeout"}
                label={t("sections.timeout.nonStreamingTotal.label")}
                description={t("sections.timeout.nonStreamingTotal.desc")}
                value={state.network.requestTimeoutNonStreamingSeconds}
                defaultValue={PROVIDER_TIMEOUT_DEFAULTS.REQUEST_TIMEOUT_NON_STREAMING_MS / 1000}
                placeholder={t("sections.timeout.nonStreamingTotal.placeholder")}
                onChange={(value) =>
                  dispatch({ type: "SET_REQUEST_TIMEOUT_NON_STREAMING", payload: value })
                }
                disabled={state.ui.isPending}
                min="0"
                max="1200"
                icon={Clock}
                isCore={true}
              />
            </div>
          </FieldGroup>

          {/* Timeout Summary */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
            <Timer className="h-4 w-4 text-primary" />
            <div className="flex-1 text-xs text-muted-foreground">
              {t("sections.timeout.summary", {
                streaming:
                  state.network.firstByteTimeoutStreamingSeconds ??
                  PROVIDER_TIMEOUT_DEFAULTS.FIRST_BYTE_TIMEOUT_STREAMING_MS / 1000,
                idle:
                  state.network.streamingIdleTimeoutSeconds ??
                  PROVIDER_TIMEOUT_DEFAULTS.STREAMING_IDLE_TIMEOUT_MS / 1000,
                nonStreaming:
                  state.network.requestTimeoutNonStreamingSeconds ??
                  PROVIDER_TIMEOUT_DEFAULTS.REQUEST_TIMEOUT_NON_STREAMING_MS / 1000,
              })}
            </div>
          </div>

          <p className="text-xs text-amber-600">{t("sections.timeout.disableHint")}</p>
        </div>
      </SectionCard>
    </motion.div>
  );
}
