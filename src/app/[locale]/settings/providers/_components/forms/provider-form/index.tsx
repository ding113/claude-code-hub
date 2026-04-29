"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
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
import { getProviderEndpoints } from "@/lib/api-client/v1/actions/provider-endpoints";
import {
  addProvider,
  editProvider,
  removeProvider,
  undoProviderDelete,
  undoProviderPatch,
} from "@/lib/api-client/v1/actions/providers";
import { getDistinctProviderGroupsAction } from "@/lib/api-client/v1/actions/request-filters";
import {
  type CustomHeadersValidationErrorCode,
  parseCustomHeadersJsonText,
} from "@/lib/custom-headers";
import { PROVIDER_BATCH_PATCH_ERROR_CODES } from "@/lib/provider-batch-patch-error-codes";
import { isValidUrl } from "@/lib/utils/validation";
import type { ProviderDisplay, ProviderEndpoint, ProviderType } from "@/types/provider";
import { invalidateProviderQueries } from "../../invalidate-provider-queries";
import { FormTabNav, NAV_ORDER, PARENT_MAP, TAB_ORDER } from "./components/form-tab-nav";
import { ProviderFormProvider, useProviderForm } from "./provider-form-context";
import type { NavTargetId, SubTabId, TabId } from "./provider-form-types";
import { BasicInfoSection } from "./sections/basic-info-section";
import { LimitsSection } from "./sections/limits-section";
import { NetworkSection } from "./sections/network-section";
import { OptionsSection } from "./sections/options-section";
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

// Map shared custom-headers parser error codes to localized message keys (settings.providers.form scope)
const CUSTOM_HEADERS_ERROR_KEYS: Record<CustomHeadersValidationErrorCode, string> = {
  invalid_json: "sections.routing.customHeaders.errors.invalidJson",
  not_object: "sections.routing.customHeaders.errors.notObject",
  invalid_name: "sections.routing.customHeaders.errors.invalidName",
  duplicate_name: "sections.routing.customHeaders.errors.duplicateName",
  protected_name: "sections.routing.customHeaders.errors.protectedName",
  invalid_value: "sections.routing.customHeaders.errors.invalidValue",
  empty_name: "sections.routing.customHeaders.errors.emptyName",
  crlf: "sections.routing.customHeaders.errors.crlf",
};

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
  const tBatchEdit = useTranslations("settings.providers.batchEdit");
  const { state, dispatch, mode, provider, hideUrl } = useProviderForm();
  const rateLimit = state.rateLimit as typeof state.rateLimit & {
    limit5hResetMode?: "fixed" | "rolling";
  };
  const [isPending, startTransition] = useTransition();
  const isEdit = mode === "edit";

  const queryClient = useQueryClient();

  const doInvalidate = useCallback(() => invalidateProviderQueries(queryClient), [queryClient]);

  const resolvedEndpointPoolVendorId = useMemo(() => {
    return isEdit ? (provider?.providerVendorId ?? null) : null;
  }, [isEdit, provider?.providerVendorId]);

  const endpointPoolQueryKey = useMemo(() => {
    if (resolvedEndpointPoolVendorId == null) return null;
    return [
      "provider-endpoints",
      resolvedEndpointPoolVendorId,
      state.routing.providerType,
      "provider-form",
    ] as const;
  }, [resolvedEndpointPoolVendorId, state.routing.providerType]);

  const { data: endpointPoolEndpoints = [] } = useQuery<ProviderEndpoint[]>({
    enabled: !hideUrl && endpointPoolQueryKey != null,
    queryKey: endpointPoolQueryKey ?? ["provider-endpoints", "unresolved", "provider-form"],
    queryFn: async () => {
      if (resolvedEndpointPoolVendorId == null) return [];
      return await getProviderEndpoints({
        vendorId: resolvedEndpointPoolVendorId,
        providerType: state.routing.providerType,
      });
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const enabledEndpointPoolEndpoints = useMemo(
    () => endpointPoolEndpoints.filter((e) => e.isEnabled && !e.deletedAt),
    [endpointPoolEndpoints]
  );

  const endpointPoolHasEnabledEndpoints = enabledEndpointPoolEndpoints.length > 0;
  const endpointPoolPreferredUrl =
    (enabledEndpointPoolEndpoints[0] ?? endpointPoolEndpoints[0])?.url ?? null;

  const endpointPoolHideLegacyUrlInput =
    !hideUrl && resolvedEndpointPoolVendorId != null && endpointPoolHasEnabledEndpoints;

  // Keep state.basic.url usable across other sections when legacy URL input is hidden.
  // Update URL when resolved URL changes
  useEffect(() => {
    if (resolvedUrl && !state.basic.url && !isEdit) {
      dispatch({ type: "SET_URL", payload: resolvedUrl });
    }
  }, [resolvedUrl, state.basic.url, isEdit, dispatch]);

  // Scroll navigation state - all sections stacked vertically
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<NavTargetId, HTMLDivElement | null>>(
    Object.fromEntries(NAV_ORDER.map((id) => [id, null])) as Record<
      NavTargetId,
      HTMLDivElement | null
    >
  );
  const isScrollingToSection = useRef(false);
  const rafRef = useRef<number | null>(null);
  const scrollLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollEndListenerRef = useRef<(() => void) | null>(null);

  // Refs for scroll handler to avoid re-creating the callback on every tab change
  const activeTabRef = useRef(state.ui.activeTab);
  const activeSubTabRef = useRef(state.ui.activeSubTab);

  useEffect(() => {
    activeTabRef.current = state.ui.activeTab;
    activeSubTabRef.current = state.ui.activeSubTab;
  }, [state.ui.activeTab, state.ui.activeSubTab]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (scrollLockTimerRef.current) clearTimeout(scrollLockTimerRef.current);
      if (scrollEndListenerRef.current) {
        contentRef.current?.removeEventListener("scrollend", scrollEndListenerRef.current);
      }
    };
  }, []);

  // Scroll to section when tab is clicked
  const scrollToSection = useCallback((tab: NavTargetId) => {
    const section = sectionRefs.current[tab];
    if (section && contentRef.current) {
      isScrollingToSection.current = true;
      const containerTop = contentRef.current.getBoundingClientRect().top;
      const sectionTop = section.getBoundingClientRect().top;
      const offset = sectionTop - containerTop + contentRef.current.scrollTop;
      contentRef.current.scrollTo({ top: offset, behavior: "smooth" });
      if (scrollLockTimerRef.current) clearTimeout(scrollLockTimerRef.current);
      if (scrollEndListenerRef.current) {
        contentRef.current.removeEventListener("scrollend", scrollEndListenerRef.current);
      }
      const unlock = () => {
        isScrollingToSection.current = false;
      };
      const onScrollEnd = () => {
        if (scrollLockTimerRef.current) clearTimeout(scrollLockTimerRef.current);
        scrollEndListenerRef.current = null;
        unlock();
      };
      scrollEndListenerRef.current = onScrollEnd;
      contentRef.current.addEventListener("scrollend", onScrollEnd, { once: true });
      scrollLockTimerRef.current = setTimeout(() => {
        contentRef.current?.removeEventListener("scrollend", onScrollEnd);
        scrollEndListenerRef.current = null;
        unlock();
      }, 1000);
    }
  }, []);

  // Detect active section based on scroll position (throttled via rAF)
  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (isScrollingToSection.current || !contentRef.current) return;
      const container = contentRef.current;
      const containerRect = container.getBoundingClientRect();
      let activeSection: NavTargetId = TAB_ORDER[0] ?? "basic";
      let minDistance = Infinity;
      for (const id of NAV_ORDER) {
        const section = sectionRefs.current[id];
        if (!section) continue;
        const sectionRect = section.getBoundingClientRect();
        const distanceFromTop = Math.abs(sectionRect.top - containerRect.top);
        if (distanceFromTop < minDistance) {
          minDistance = distanceFromTop;
          activeSection = id;
        }
      }
      const parentTab =
        activeSection in PARENT_MAP
          ? PARENT_MAP[activeSection as SubTabId]
          : (activeSection as TabId);
      const subTab = activeSection in PARENT_MAP ? (activeSection as SubTabId) : null;
      if (activeTabRef.current !== parentTab || activeSubTabRef.current !== subTab) {
        dispatch({ type: "SET_ACTIVE_NAV", payload: { tab: parentTab, subTab } });
      }
    });
  }, [dispatch]);

  const handleTabChange = (tab: TabId) => {
    dispatch({ type: "SET_ACTIVE_TAB", payload: tab });
    scrollToSection(tab);
  };

  const handleSubTabChange = (subTab: SubTabId) => {
    const parentTab = PARENT_MAP[subTab];
    dispatch({ type: "SET_ACTIVE_NAV", payload: { tab: parentTab, subTab } });
    scrollToSection(subTab);
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

    const needsLegacyUrl = !hideUrl && !endpointPoolHideLegacyUrlInput;
    if (needsLegacyUrl && !state.basic.url.trim()) {
      return t("errors.urlRequired");
    }
    if (needsLegacyUrl && !isValidUrl(state.basic.url)) {
      return t("errors.invalidUrl");
    }

    if (!isEdit && !state.basic.key.trim()) {
      return t("errors.keyRequired");
    }

    // Custom headers JSON: parse-on-submit; invalid input maps to a localized message
    if (mode !== "batch") {
      const customHeadersResult = parseCustomHeadersJsonText(state.routing.customHeadersText);
      if (!customHeadersResult.ok) {
        return t(CUSTOM_HEADERS_ERROR_KEYS[customHeadersResult.code]);
      }
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

        // Static custom headers: validateForm has already rejected invalid input,
        // so the parse here is guaranteed to succeed at this point.
        const parsedCustomHeadersResult = parseCustomHeadersJsonText(
          state.routing.customHeadersText
        );
        const parsedCustomHeaders = parsedCustomHeadersResult.ok
          ? (parsedCustomHeadersResult.value ?? null)
          : null;

        // Base form data without key (for type safety)
        const effectiveProviderUrl = endpointPoolHideLegacyUrlInput
          ? (endpointPoolPreferredUrl ?? state.basic.url).trim()
          : state.basic.url.trim();

        const baseFormData = {
          name: state.basic.name.trim(),
          url: effectiveProviderUrl,
          website_url: state.basic.websiteUrl?.trim() || null,
          provider_type: state.routing.providerType,
          preserve_client_ip: state.routing.preserveClientIp,
          disable_session_reuse: state.routing.disableSessionReuse,
          model_redirects:
            state.routing.modelRedirects.length > 0 ? state.routing.modelRedirects : null,
          allowed_models:
            state.routing.allowedModels.length > 0 ? state.routing.allowedModels : null,
          allowed_clients: state.routing.allowedClients,
          blocked_clients: state.routing.blockedClients,
          priority: state.routing.priority,
          group_priorities:
            Object.keys(state.routing.groupPriorities).length > 0
              ? state.routing.groupPriorities
              : null,
          weight: state.routing.weight,
          cost_multiplier: state.routing.costMultiplier,
          group_tag: state.routing.groupTag.length > 0 ? state.routing.groupTag.join(",") : null,
          cache_ttl_preference: state.routing.cacheTtlPreference,
          swap_cache_ttl_billing: state.routing.swapCacheTtlBilling,
          codex_reasoning_effort_preference: state.routing.codexReasoningEffortPreference,
          codex_reasoning_summary_preference: state.routing.codexReasoningSummaryPreference,
          codex_text_verbosity_preference: state.routing.codexTextVerbosityPreference,
          codex_parallel_tool_calls_preference: state.routing.codexParallelToolCallsPreference,
          codex_service_tier_preference: state.routing.codexServiceTierPreference,
          anthropic_max_tokens_preference: state.routing.anthropicMaxTokensPreference,
          anthropic_thinking_budget_preference: state.routing.anthropicThinkingBudgetPreference,
          anthropic_adaptive_thinking: state.routing.anthropicAdaptiveThinking,
          gemini_google_search_preference: state.routing.geminiGoogleSearchPreference,
          active_time_start: state.routing.activeTimeStart || null,
          active_time_end: state.routing.activeTimeEnd || null,
          limit_5h_usd: state.rateLimit.limit5hUsd,
          limit_5h_reset_mode: rateLimit.limit5hResetMode ?? "rolling",
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
          custom_headers: parsedCustomHeaders,
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

          const undoToken = res.data.undoToken;
          const operationId = res.data.operationId;

          toast.success(tBatchEdit("undo.singleEditSuccess"), {
            duration: 10000,
            action: {
              label: tBatchEdit("undo.button"),
              onClick: async () => {
                try {
                  const undoResult = await undoProviderPatch({ undoToken, operationId });
                  if (undoResult.ok) {
                    toast.success(tBatchEdit("undo.singleEditUndone"));
                    await doInvalidate();
                  } else if (
                    undoResult.errorCode === PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED
                  ) {
                    toast.error(tBatchEdit("undo.expired"));
                  } else {
                    toast.error(tBatchEdit("undo.failed"));
                  }
                } catch {
                  toast.error(tBatchEdit("undo.failed"));
                }
              },
            },
          });

          void doInvalidate();
        } else {
          // For create: key is required
          const createFormData = { ...baseFormData, key: trimmedKey };
          const res = await addProvider(createFormData);
          if (!res.ok) {
            toast.error(res.error || t("errors.addFailed"));
            return;
          }

          void doInvalidate();

          toast.success(t("success.created"));
          dispatch({ type: "RESET_FORM" });
        }

        try {
          onSuccess?.();
        } catch (e) {
          console.error("onSuccess callback failed", e);
        }
      } catch (e) {
        console.error("Form submission error:", e);
        toast.error(isEdit ? t("errors.updateFailed") : t("errors.addFailed"));
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

        const undoToken = res.data.undoToken;
        const operationId = res.data.operationId;

        toast.success(tBatchEdit("undo.singleDeleteSuccess"), {
          duration: 10000,
          action: {
            label: tBatchEdit("undo.button"),
            onClick: async () => {
              try {
                const undoResult = await undoProviderDelete({ undoToken, operationId });
                if (undoResult.ok) {
                  toast.success(tBatchEdit("undo.singleDeleteUndone"));
                  await doInvalidate();
                } else if (undoResult.errorCode === PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED) {
                  toast.error(tBatchEdit("undo.expired"));
                } else {
                  toast.error(tBatchEdit("undo.failed"));
                }
              } catch {
                toast.error(tBatchEdit("undo.failed"));
              }
            },
          },
        });

        void doInvalidate();
        onSuccess?.();
      } catch (e) {
        console.error("Delete error:", e);
        toast.error(t("errors.deleteFailed"));
      }
    });
  };

  // Tab status indicators (memoized to avoid object recreation per render)
  const tabStatus = useMemo((): Partial<Record<TabId, "default" | "warning" | "configured">> => {
    const status: Partial<Record<TabId, "default" | "warning" | "configured">> = {};

    // Basic - warning if required fields missing
    const needsLegacyUrl = !hideUrl && !endpointPoolHideLegacyUrlInput;
    if (!state.basic.name.trim() || (needsLegacyUrl && !state.basic.url.trim())) {
      status.basic = "warning";
    }

    // Routing - configured if models/redirects set
    if (state.routing.allowedModels.length > 0 || state.routing.modelRedirects.length > 0) {
      status.routing = "configured";
    }

    if (
      // Advanced options
      state.routing.preserveClientIp ||
      state.routing.cacheTtlPreference !== "inherit" ||
      state.routing.swapCacheTtlBilling ||
      // Codex overrides
      state.routing.codexReasoningEffortPreference !== "inherit" ||
      state.routing.codexReasoningSummaryPreference !== "inherit" ||
      state.routing.codexTextVerbosityPreference !== "inherit" ||
      state.routing.codexParallelToolCallsPreference !== "inherit" ||
      state.routing.codexServiceTierPreference !== "inherit" ||
      // Anthropic overrides
      state.routing.anthropicMaxTokensPreference !== "inherit" ||
      state.routing.anthropicThinkingBudgetPreference !== "inherit" ||
      state.routing.anthropicAdaptiveThinking !== null ||
      // Gemini overrides
      state.routing.geminiGoogleSearchPreference !== "inherit" ||
      // Active time
      state.routing.activeTimeStart !== null ||
      state.routing.activeTimeEnd !== null ||
      // Custom headers
      state.routing.customHeadersText.trim().length > 0
    ) {
      status.options = "configured";
    }

    // Limits - configured if any rate limit set
    if (
      state.rateLimit.limit5hUsd ||
      rateLimit.limit5hResetMode !== "rolling" ||
      state.rateLimit.limitDailyUsd ||
      state.rateLimit.dailyResetMode !== "fixed" ||
      state.rateLimit.dailyResetTime !== "00:00" ||
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
  }, [
    state.basic,
    state.routing,
    state.rateLimit,
    rateLimit.limit5hResetMode,
    state.network,
    state.mcp,
    hideUrl,
    endpointPoolHideLegacyUrlInput,
  ]);

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col h-full max-h-[var(--cch-viewport-height-85)]"
    >
      {/* Form Layout */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
        <div className="order-2 md:order-1 shrink-0">
          {/* Tab Navigation */}
          <FormTabNav
            activeTab={state.ui.activeTab}
            activeSubTab={state.ui.activeSubTab}
            onTabChange={handleTabChange}
            onSubTabChange={handleSubTabChange}
            disabled={isPending}
            tabStatus={tabStatus}
          />
        </div>

        {/* All Sections Stacked Vertically */}
        <div
          ref={contentRef}
          className="order-1 md:order-2 flex-1 overflow-y-auto p-6 min-h-0 scroll-smooth"
          onScroll={handleScroll}
        >
          <div className="space-y-8">
            {/* Basic Info Section */}
            <div
              ref={(el) => {
                sectionRefs.current.basic = el;
              }}
            >
              <BasicInfoSection
                autoUrlPending={autoUrlPending}
                endpointPool={
                  !hideUrl && resolvedEndpointPoolVendorId != null
                    ? {
                        vendorId: resolvedEndpointPoolVendorId,
                        providerType: state.routing.providerType,
                        hideLegacyUrlInput: endpointPoolHideLegacyUrlInput,
                      }
                    : null
                }
              />
            </div>

            {/* Routing Section */}
            <div
              ref={(el) => {
                sectionRefs.current.routing = el;
              }}
            >
              <RoutingSection
                subSectionRefs={{
                  scheduling: (el) => {
                    sectionRefs.current.scheduling = el;
                  },
                }}
              />
            </div>

            {/* Options Section */}
            <div
              ref={(el) => {
                sectionRefs.current.options = el;
              }}
            >
              <OptionsSection
                subSectionRefs={{
                  activeTime: (el) => {
                    sectionRefs.current.activeTime = el;
                  },
                }}
              />
            </div>

            {/* Limits Section */}
            <div
              ref={(el) => {
                sectionRefs.current.limits = el;
              }}
            >
              <LimitsSection
                subSectionRefs={{
                  circuitBreaker: (el) => {
                    sectionRefs.current.circuitBreaker = el;
                  },
                }}
              />
            </div>

            {/* Network Section */}
            <div
              ref={(el) => {
                sectionRefs.current.network = el;
              }}
            >
              <NetworkSection
                subSectionRefs={{
                  timeout: (el) => {
                    sectionRefs.current.timeout = el;
                  },
                }}
              />
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
  allowedProviderTypes: _allowedProviderTypes,
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
