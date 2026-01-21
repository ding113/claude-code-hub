"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { addProvider, editProvider, removeProvider } from "@/actions/providers";
import { getDistinctProviderGroupsAction } from "@/actions/request-filters";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTrigger,
  AlertDialogHeader as AlertHeader,
  AlertDialogTitle as AlertTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { isValidUrl } from "@/lib/utils/validation";
import type { ProviderDisplay, ProviderType } from "@/types/provider";
import { FormTabNav } from "./components/form-tab-nav";
import { ProviderFormProvider, useProviderForm } from "./provider-form-context";
import type { TabId } from "./provider-form-types";
import { BasicInfoSection } from "./sections/basic-info-section";
import { LimitsSection } from "./sections/limits-section";
import { NetworkSection } from "./sections/network-section";
import { RoutingSection } from "./sections/routing-section";
import { TestingSection } from "./sections/testing-section";

export interface ProviderFormProps {
  mode: "create" | "edit";
  onSuccess?: () => void;
  provider?: ProviderDisplay;
  cloneProvider?: ProviderDisplay;
  enableMultiProviderTypes: boolean;
  hideUrl?: boolean;
  hideWebsiteUrl?: boolean;
  preset?: {
    name?: string;
    url?: string;
    websiteUrl?: string;
    providerType?: ProviderType;
  };
  urlResolver?: (providerType: ProviderType) => Promise<string | null>;
  allowedProviderTypes?: ProviderType[];
}

// Internal form component that uses context
function ProviderFormContent({
  onSuccess,
  autoUrlPending,
  resolvedUrl,
}: {
  onSuccess?: () => void;
  autoUrlPending: boolean;
  resolvedUrl?: string | null;
}) {
  const t = useTranslations("settings.providers.form");
  const { state, dispatch, mode, provider, hideUrl } = useProviderForm();
  const [isPending, startTransition] = useTransition();
  const isEdit = mode === "edit";

  // Update URL when resolved URL changes
  useEffect(() => {
    if (resolvedUrl && !state.basic.url && !isEdit) {
      dispatch({ type: "SET_URL", payload: resolvedUrl });
    }
  }, [resolvedUrl, state.basic.url, isEdit, dispatch]);

  // Scroll navigation state - all sections stacked vertically
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<TabId, HTMLDivElement | null>>({
    basic: null,
    routing: null,
    limits: null,
    network: null,
    testing: null,
  });
  const isScrollingToSection = useRef(false);

  // Tab order for navigation
  const tabOrder: TabId[] = ["basic", "routing", "limits", "network", "testing"];

  // Scroll to section when tab is clicked
  const scrollToSection = useCallback((tab: TabId) => {
    const section = sectionRefs.current[tab];
    if (section && contentRef.current) {
      isScrollingToSection.current = true;
      const containerTop = contentRef.current.getBoundingClientRect().top;
      const sectionTop = section.getBoundingClientRect().top;
      const offset = sectionTop - containerTop + contentRef.current.scrollTop;
      contentRef.current.scrollTo({ top: offset, behavior: "smooth" });
      setTimeout(() => {
        isScrollingToSection.current = false;
      }, 500);
    }
  }, []);

  // Detect active section based on scroll position
  const handleScroll = useCallback(() => {
    if (isScrollingToSection.current || !contentRef.current) return;

    const container = contentRef.current;
    const containerRect = container.getBoundingClientRect();
    const _scrollTop = container.scrollTop;

    // Find which section is at the top of the viewport
    let activeSection: TabId = "basic";
    let minDistance = Infinity;

    for (const tab of tabOrder) {
      const section = sectionRefs.current[tab];
      if (!section) continue;

      const sectionRect = section.getBoundingClientRect();
      const distanceFromTop = Math.abs(sectionRect.top - containerRect.top);

      if (distanceFromTop < minDistance) {
        minDistance = distanceFromTop;
        activeSection = tab;
      }
    }

    if (state.ui.activeTab !== activeSection) {
      dispatch({ type: "SET_ACTIVE_TAB", payload: activeSection });
    }
  }, [dispatch, state.ui.activeTab]);

  const handleTabChange = (tab: TabId) => {
    dispatch({ type: "SET_ACTIVE_TAB", payload: tab });
    scrollToSection(tab);
  };

  // Sync isPending to context
  useEffect(() => {
    dispatch({ type: "SET_IS_PENDING", payload: isPending });
  }, [isPending, dispatch]);

  // Form validation
  const validateForm = (): string | null => {
    if (!state.basic.name.trim()) {
      return t("errors.nameRequired");
    }
    if (!hideUrl && !state.basic.url.trim()) {
      return t("errors.urlRequired");
    }
    if (!hideUrl && !isValidUrl(state.basic.url)) {
      return t("errors.invalidUrl");
    }
    if (!isEdit && !state.basic.key.trim()) {
      return t("errors.keyRequired");
    }
    return null;
  };

  // Check if failureThreshold needs confirmation
  const needsFailureThresholdConfirm = () => {
    const threshold = state.circuitBreaker.failureThreshold;
    return threshold === 0 || (threshold !== undefined && threshold > 20);
  };

  // Actual form submission
  const performSubmit = () => {
    startTransition(async () => {
      try {
        // Convert duration from minutes to milliseconds
        const openDurationMs = state.circuitBreaker.openDurationMinutes
          ? state.circuitBreaker.openDurationMinutes * 60 * 1000
          : undefined;

        // Convert seconds to milliseconds for timeout fields
        const firstByteTimeoutMs =
          state.network.firstByteTimeoutStreamingSeconds !== undefined
            ? state.network.firstByteTimeoutStreamingSeconds * 1000
            : undefined;
        const idleTimeoutMs =
          state.network.streamingIdleTimeoutSeconds !== undefined
            ? state.network.streamingIdleTimeoutSeconds * 1000
            : undefined;
        const nonStreamingTimeoutMs =
          state.network.requestTimeoutNonStreamingSeconds !== undefined
            ? state.network.requestTimeoutNonStreamingSeconds * 1000
            : undefined;

        // Handle key: in edit mode, only include if user provided a new key
        const trimmedKey = state.basic.key.trim();

        // Base form data without key (for type safety)
        const baseFormData = {
          name: state.basic.name.trim(),
          url: state.basic.url.trim(),
          website_url: state.basic.websiteUrl?.trim() || null,
          provider_type: state.routing.providerType,
          preserve_client_ip: state.routing.preserveClientIp,
          model_redirects: state.routing.modelRedirects,
          allowed_models:
            state.routing.allowedModels.length > 0 ? state.routing.allowedModels : null,
          join_claude_pool: state.routing.joinClaudePool,
          priority: state.routing.priority,
          weight: state.routing.weight,
          cost_multiplier: state.routing.costMultiplier,
          group_tag: state.routing.groupTag.length > 0 ? state.routing.groupTag.join(",") : null,
          cache_ttl_preference: state.routing.cacheTtlPreference,
          context_1m_preference: state.routing.context1mPreference,
          codex_reasoning_effort_preference: state.routing.codexReasoningEffortPreference,
          codex_reasoning_summary_preference: state.routing.codexReasoningSummaryPreference,
          codex_text_verbosity_preference: state.routing.codexTextVerbosityPreference,
          codex_parallel_tool_calls_preference: state.routing.codexParallelToolCallsPreference,
          limit_5h_usd: state.rateLimit.limit5hUsd,
          limit_daily_usd: state.rateLimit.limitDailyUsd,
          daily_reset_mode: state.rateLimit.dailyResetMode,
          daily_reset_time: state.rateLimit.dailyResetTime,
          limit_weekly_usd: state.rateLimit.limitWeeklyUsd,
          limit_monthly_usd: state.rateLimit.limitMonthlyUsd,
          limit_total_usd: state.rateLimit.limitTotalUsd,
          limit_concurrent_sessions: state.rateLimit.limitConcurrentSessions,
          circuit_breaker_failure_threshold: state.circuitBreaker.failureThreshold,
          circuit_breaker_open_duration: openDurationMs,
          circuit_breaker_half_open_success_threshold:
            state.circuitBreaker.halfOpenSuccessThreshold,
          max_retry_attempts: state.circuitBreaker.maxRetryAttempts,
          proxy_url: state.network.proxyUrl?.trim() || null,
          proxy_fallback_to_direct: state.network.proxyFallbackToDirect,
          first_byte_timeout_streaming_ms: firstByteTimeoutMs,
          streaming_idle_timeout_ms: idleTimeoutMs,
          request_timeout_non_streaming_ms: nonStreamingTimeoutMs,
          mcp_passthrough_type: state.mcp.mcpPassthroughType,
          mcp_passthrough_url: state.mcp.mcpPassthroughUrl?.trim() || null,
          tpm: null,
          rpm: null,
          rpd: null,
          cc: null,
        };

        if (isEdit && provider) {
          // For edit: only include key if user provided a new one
          const editFormData = trimmedKey ? { ...baseFormData, key: trimmedKey } : baseFormData;
          const res = await editProvider(provider.id, editFormData);
          if (!res.ok) {
            toast.error(res.error || t("errors.updateFailed"));
            return;
          }
          toast.success(t("success.updated"));
        } else {
          // For create: key is required
          const createFormData = { ...baseFormData, key: trimmedKey };
          const res = await addProvider(createFormData);
          if (!res.ok) {
            toast.error(res.error || t("errors.createFailed"));
            return;
          }
          toast.success(t("success.created"));
          dispatch({ type: "RESET_FORM" });
        }
        onSuccess?.();
      } catch (e) {
        console.error("Form submission error:", e);
        toast.error(isEdit ? t("errors.updateFailed") : t("errors.createFailed"));
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const error = validateForm();
    if (error) {
      toast.error(error);
      return;
    }

    // Check if failureThreshold needs confirmation
    if (needsFailureThresholdConfirm()) {
      dispatch({ type: "SET_SHOW_FAILURE_THRESHOLD_CONFIRM", payload: true });
      return;
    }

    performSubmit();
  };

  const handleDelete = () => {
    if (!provider) return;
    startTransition(async () => {
      try {
        const res = await removeProvider(provider.id);
        if (!res.ok) {
          toast.error(res.error || t("errors.deleteFailed"));
          return;
        }
        toast.success(t("success.deleted"));
        onSuccess?.();
      } catch (e) {
        console.error("Delete error:", e);
        toast.error(t("errors.deleteFailed"));
      }
    });
  };

  // Tab status indicators
  const getTabStatus = (): Partial<Record<TabId, "default" | "warning" | "configured">> => {
    const status: Partial<Record<TabId, "default" | "warning" | "configured">> = {};

    // Basic - warning if required fields missing
    if (!state.basic.name.trim() || (!hideUrl && !state.basic.url.trim())) {
      status.basic = "warning";
    }

    // Routing - configured if models/redirects set
    if (
      state.routing.allowedModels.length > 0 ||
      Object.keys(state.routing.modelRedirects).length > 0
    ) {
      status.routing = "configured";
    }

    // Limits - configured if any limit set
    if (
      state.rateLimit.limit5hUsd ||
      state.rateLimit.limitDailyUsd ||
      state.rateLimit.limitWeeklyUsd ||
      state.rateLimit.limitMonthlyUsd ||
      state.rateLimit.limitTotalUsd ||
      state.rateLimit.limitConcurrentSessions
    ) {
      status.limits = "configured";
    }

    // Network - configured if proxy set
    if (state.network.proxyUrl) {
      status.network = "configured";
    }

    // Testing - configured if MCP enabled
    if (state.mcp.mcpPassthroughType !== "none") {
      status.testing = "configured";
    }

    return status;
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full max-h-[85vh]">
      {/* Form Layout */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
        {/* Tab Navigation */}
        <FormTabNav
          activeTab={state.ui.activeTab}
          onTabChange={handleTabChange}
          disabled={isPending}
          tabStatus={getTabStatus()}
        />

        {/* All Sections Stacked Vertically */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto p-6 pb-24 md:pb-6 min-h-0 scroll-smooth"
          onScroll={handleScroll}
        >
          <div className="space-y-8">
            {/* Basic Info Section */}
            <div
              ref={(el) => {
                sectionRefs.current.basic = el;
              }}
            >
              <BasicInfoSection autoUrlPending={autoUrlPending} />
            </div>

            {/* Routing Section */}
            <div
              ref={(el) => {
                sectionRefs.current.routing = el;
              }}
            >
              <RoutingSection />
            </div>

            {/* Limits Section */}
            <div
              ref={(el) => {
                sectionRefs.current.limits = el;
              }}
            >
              <LimitsSection />
            </div>

            {/* Network Section */}
            <div
              ref={(el) => {
                sectionRefs.current.network = el;
              }}
            >
              <NetworkSection />
            </div>

            {/* Testing Section */}
            <div
              ref={(el) => {
                sectionRefs.current.testing = el;
              }}
            >
              <TestingSection />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-6 py-4 border-t bg-card/50 backdrop-blur-sm">
        {isEdit ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <AlertDialog>
              <Button type="button" variant="destructive" disabled={isPending} asChild>
                <AlertDialogTrigger>{t("buttons.delete")}</AlertDialogTrigger>
              </Button>
              <AlertDialogContent>
                <AlertHeader>
                  <AlertTitle>{t("deleteDialog.title")}</AlertTitle>
                  <AlertDialogDescription>
                    {t("deleteDialog.description", { name: provider?.name ?? "" })}
                  </AlertDialogDescription>
                </AlertHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("deleteDialog.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>
                    {t("deleteDialog.confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button type="submit" disabled={isPending}>
              {isPending ? t("buttons.updating") : t("buttons.update")}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending ? t("buttons.submitting") : t("buttons.submit")}
            </Button>
          </div>
        )}
      </div>

      {/* Failure Threshold Confirmation Dialog */}
      <AlertDialog
        open={state.ui.showFailureThresholdConfirm}
        onOpenChange={(open) =>
          dispatch({ type: "SET_SHOW_FAILURE_THRESHOLD_CONFIRM", payload: open })
        }
      >
        <AlertDialogContent>
          <AlertHeader>
            <AlertTitle>{t("failureThresholdConfirmDialog.title")}</AlertTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {state.circuitBreaker.failureThreshold === 0 ? (
                  <p>
                    {t("failureThresholdConfirmDialog.descriptionDisabledPrefix")}
                    <strong>{t("failureThresholdConfirmDialog.descriptionDisabledValue")}</strong>
                    {t("failureThresholdConfirmDialog.descriptionDisabledMiddle")}
                    <strong>{t("failureThresholdConfirmDialog.descriptionDisabledAction")}</strong>
                    {t("failureThresholdConfirmDialog.descriptionDisabledSuffix")}
                  </p>
                ) : (
                  <p>
                    {t("failureThresholdConfirmDialog.descriptionHighValuePrefix")}
                    <strong>{state.circuitBreaker.failureThreshold}</strong>
                    {t("failureThresholdConfirmDialog.descriptionHighValueSuffix")}
                  </p>
                )}
                <p>{t("failureThresholdConfirmDialog.confirmQuestion")}</p>
              </div>
            </AlertDialogDescription>
          </AlertHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("failureThresholdConfirmDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                dispatch({ type: "SET_SHOW_FAILURE_THRESHOLD_CONFIRM", payload: false });
                performSubmit();
              }}
            >
              {t("failureThresholdConfirmDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

// Main exported component with provider wrapper
export function ProviderForm({
  mode,
  onSuccess,
  provider,
  cloneProvider,
  enableMultiProviderTypes,
  hideUrl = false,
  hideWebsiteUrl = false,
  preset,
  urlResolver,
  allowedProviderTypes,
}: ProviderFormProps) {
  const [groupSuggestions, setGroupSuggestions] = useState<string[]>([]);
  const [autoUrlPending, setAutoUrlPending] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  // Fetch group suggestions
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const res = await getDistinctProviderGroupsAction();
        if (res.ok && res.data) {
          setGroupSuggestions(res.data);
        }
      } catch (e) {
        console.error("Failed to fetch group suggestions:", e);
      }
    };
    fetchGroups();
  }, []);

  // Handle URL resolver for preset provider types
  useEffect(() => {
    if (urlResolver && preset?.providerType && !preset?.url) {
      setAutoUrlPending(true);
      urlResolver(preset.providerType)
        .then((url) => {
          if (url) {
            setResolvedUrl(url);
          }
        })
        .catch((e) => {
          console.error("Failed to resolve provider URL:", e);
        })
        .finally(() => {
          setAutoUrlPending(false);
        });
    }
  }, [urlResolver, preset?.providerType, preset?.url]);

  // Build effective preset with resolved URL
  const effectivePreset = preset
    ? {
        ...preset,
        url: preset.url || resolvedUrl || undefined,
      }
    : undefined;

  return (
    <ProviderFormProvider
      mode={mode}
      provider={provider}
      cloneProvider={cloneProvider}
      enableMultiProviderTypes={enableMultiProviderTypes}
      hideUrl={hideUrl}
      hideWebsiteUrl={hideWebsiteUrl}
      preset={effectivePreset}
      groupSuggestions={groupSuggestions}
    >
      <ProviderFormContent
        onSuccess={onSuccess}
        autoUrlPending={autoUrlPending}
        resolvedUrl={resolvedUrl}
      />
    </ProviderFormProvider>
  );
}

export default ProviderForm;
