"use server";

import { z } from "zod";
import {
  checkFormatProviderTypeCompatibility,
  checkProviderGroupMatch,
  isProviderActiveNow,
  ProxyProviderResolver,
  providerSupportsModel,
} from "@/app/v1/_lib/proxy/provider-selector";
import { getSession } from "@/lib/auth";
import { getCircuitState, isCircuitOpen } from "@/lib/circuit-breaker";
import { getEndpointFilterStats } from "@/lib/provider-endpoints/endpoint-selector";
import { getProviderModelRedirectTarget } from "@/lib/provider-model-redirects";
import { RateLimitService } from "@/lib/rate-limit";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import { isVendorTypeCircuitOpen } from "@/lib/vendor-type-circuit-breaker";
import { findAllProvidersFresh } from "@/repository/provider";
import type {
  DispatchSimulatorEndpointStats,
  DispatchSimulatorInput,
  DispatchSimulatorPriorityProvider,
  DispatchSimulatorPriorityTier,
  DispatchSimulatorProviderSnapshot,
  DispatchSimulatorResult,
  DispatchSimulatorStep,
  DispatchSimulatorStepName,
} from "@/types/dispatch-simulator";
import type { Provider } from "@/types/provider";
import type { ActionResult } from "./types";

const DispatchSimulatorInputSchema = z.object({
  clientFormat: z.enum(["claude", "openai", "response", "gemini"]),
  modelName: z.string().trim().max(255).default(""),
  groupTags: z.array(z.string().trim().min(1).max(255)).max(20).default([]),
});

const DISPATCH_SIMULATOR_ERROR_CODES = {
  INVALID_INPUT: "INVALID_FORMAT",
  OPERATION_FAILED: "OPERATION_FAILED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
} as const;

function getGroupFilterValue(groupTags: string[]): string | null {
  if (groupTags.length === 0) {
    return null;
  }
  return groupTags.join(",");
}

function buildProviderSnapshot(
  provider: Provider,
  userGroup: string | null,
  overrides: Partial<DispatchSimulatorProviderSnapshot> = {}
): DispatchSimulatorProviderSnapshot {
  return {
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType,
    groupTag: provider.groupTag,
    priority: provider.priority ?? 0,
    effectivePriority: ProxyProviderResolver.resolveEffectivePriority(provider, userGroup),
    weight: provider.weight,
    ...overrides,
  };
}

async function getEndpointStats(
  provider: Provider
): Promise<DispatchSimulatorEndpointStats | null> {
  if (!provider.providerVendorId) {
    return null;
  }

  try {
    return await getEndpointFilterStats({
      vendorId: provider.providerVendorId,
      providerType: provider.providerType,
    });
  } catch {
    return null;
  }
}

function buildStep(
  stepName: DispatchSimulatorStepName,
  stepIndex: number,
  inputProviders: Provider[],
  outputProviders: Provider[],
  filteredOut: DispatchSimulatorProviderSnapshot[],
  userGroup: string | null,
  note?: string
): DispatchSimulatorStep {
  return {
    stepName,
    stepIndex,
    inputCount: inputProviders.length,
    outputCount: outputProviders.length,
    filteredOut,
    surviving: outputProviders.map((provider) => buildProviderSnapshot(provider, userGroup)),
    note,
  };
}

async function buildPriorityTiers(
  providers: Provider[],
  userGroup: string | null,
  modelName: string
): Promise<DispatchSimulatorPriorityTier[]> {
  if (providers.length === 0) {
    return [];
  }

  const enriched = await Promise.all(
    providers.map(async (provider) => ({
      provider,
      redirectedModel: modelName
        ? getProviderModelRedirectTarget(modelName, provider.modelRedirects)
        : null,
      endpointStats: await getEndpointStats(provider),
    }))
  );

  const priorities = [
    ...new Set(
      enriched.map(({ provider }) =>
        ProxyProviderResolver.resolveEffectivePriority(provider, userGroup)
      )
    ),
  ].sort((a, b) => a - b);
  const selectedPriority = priorities[0] ?? null;

  return priorities.map((priority) => {
    const providersAtPriority = enriched.filter(
      ({ provider }) =>
        ProxyProviderResolver.resolveEffectivePriority(provider, userGroup) === priority
    );
    const totalWeight = providersAtPriority.reduce((sum, item) => sum + item.provider.weight, 0);

    const mappedProviders: DispatchSimulatorPriorityProvider[] = providersAtPriority.map(
      ({ provider, redirectedModel, endpointStats }) => ({
        ...buildProviderSnapshot(provider, userGroup, {
          redirectedModel,
          endpointStats,
        }),
        weightPercent:
          totalWeight > 0
            ? (provider.weight / totalWeight) * 100
            : 100 / providersAtPriority.length,
      })
    );

    return {
      priority,
      providers: mappedProviders,
      isSelected: priority === selectedPriority,
    };
  });
}

export async function simulateDispatchDecisionTree(
  providers: Provider[],
  input: DispatchSimulatorInput,
  options?: { systemTimezone?: string }
): Promise<DispatchSimulatorResult> {
  const normalizedModelName = input.modelName.trim();
  const groupFilter = getGroupFilterValue(input.groupTags);
  const systemTimezone = options?.systemTimezone ?? (await resolveSystemTimezone());
  const steps: DispatchSimulatorStep[] = [];

  let currentProviders = providers;

  const groupFiltered =
    groupFilter === null
      ? currentProviders
      : currentProviders.filter((provider) =>
          checkProviderGroupMatch(provider.groupTag, groupFilter)
        );
  steps.push(
    buildStep(
      "groupFilter",
      1,
      currentProviders,
      groupFiltered,
      groupFilter
        ? currentProviders
            .filter((provider) => !groupFiltered.some((survivor) => survivor.id === provider.id))
            .map((provider) =>
              buildProviderSnapshot(provider, groupFilter, { details: "provider_group_mismatch" })
            )
        : [],
      groupFilter,
      groupFilter ? undefined : "no_group_filter"
    )
  );
  currentProviders = groupFiltered;

  const formatCompatible = currentProviders.filter((provider) =>
    checkFormatProviderTypeCompatibility(input.clientFormat, provider.providerType)
  );
  steps.push(
    buildStep(
      "formatCompatibility",
      2,
      currentProviders,
      formatCompatible,
      currentProviders
        .filter((provider) => !formatCompatible.some((survivor) => survivor.id === provider.id))
        .map((provider) =>
          buildProviderSnapshot(provider, groupFilter, {
            details: `format ${input.clientFormat} incompatible with ${provider.providerType}`,
          })
        ),
      groupFilter
    )
  );
  currentProviders = formatCompatible;

  const enabledProviders = currentProviders.filter((provider) => provider.isEnabled);
  steps.push(
    buildStep(
      "enabledCheck",
      3,
      currentProviders,
      enabledProviders,
      currentProviders
        .filter((provider) => !enabledProviders.some((survivor) => survivor.id === provider.id))
        .map((provider) =>
          buildProviderSnapshot(provider, groupFilter, { details: "provider_disabled" })
        ),
      groupFilter
    )
  );
  currentProviders = enabledProviders;

  const activeProviders = currentProviders.filter((provider) =>
    isProviderActiveNow(provider.activeTimeStart, provider.activeTimeEnd, systemTimezone)
  );
  steps.push(
    buildStep(
      "activeTime",
      4,
      currentProviders,
      activeProviders,
      currentProviders
        .filter((provider) => !activeProviders.some((survivor) => survivor.id === provider.id))
        .map((provider) =>
          buildProviderSnapshot(provider, groupFilter, {
            details: `outside active window ${provider.activeTimeStart ?? "-"}-${provider.activeTimeEnd ?? "-"}`,
          })
        ),
      groupFilter
    )
  );
  currentProviders = activeProviders;

  const allowlistEligible =
    normalizedModelName === ""
      ? currentProviders
      : currentProviders.filter((provider) => providerSupportsModel(provider, normalizedModelName));
  steps.push(
    buildStep(
      "modelAllowlist",
      5,
      currentProviders,
      allowlistEligible,
      normalizedModelName === ""
        ? []
        : currentProviders
            .filter(
              (provider) => !allowlistEligible.some((survivor) => survivor.id === provider.id)
            )
            .map((provider) =>
              buildProviderSnapshot(provider, groupFilter, {
                details: `model ${normalizedModelName} did not match allowlist`,
              })
            ),
      groupFilter,
      normalizedModelName === "" ? "model_filter_skipped_for_resource_request" : undefined
    )
  );
  currentProviders = allowlistEligible;

  const healthyProviders: Provider[] = [];
  const healthFiltered: DispatchSimulatorProviderSnapshot[] = [];
  for (const provider of currentProviders) {
    if (
      provider.providerVendorId &&
      provider.providerVendorId > 0 &&
      (await isVendorTypeCircuitOpen(provider.providerVendorId, provider.providerType))
    ) {
      healthFiltered.push(
        buildProviderSnapshot(provider, groupFilter, { details: "vendor_type_circuit_open" })
      );
      continue;
    }

    if (await isCircuitOpen(provider.id)) {
      healthFiltered.push(
        buildProviderSnapshot(provider, groupFilter, {
          details: `provider_circuit_${getCircuitState(provider.id)}`,
        })
      );
      continue;
    }

    const costCheck = await RateLimitService.checkCostLimitsWithLease(provider.id, "provider", {
      limit_5h_usd: provider.limit5hUsd,
      limit_daily_usd: provider.limitDailyUsd,
      daily_reset_mode: provider.dailyResetMode,
      daily_reset_time: provider.dailyResetTime,
      limit_weekly_usd: provider.limitWeeklyUsd,
      limit_monthly_usd: provider.limitMonthlyUsd,
      cost_reset_at: provider.totalCostResetAt,
    });

    if (!costCheck.allowed) {
      healthFiltered.push(
        buildProviderSnapshot(provider, groupFilter, {
          details: costCheck.reason || "cost_limit_reached",
        })
      );
      continue;
    }

    const totalCheck = await RateLimitService.checkTotalCostLimit(
      provider.id,
      "provider",
      provider.limitTotalUsd,
      { resetAt: provider.totalCostResetAt }
    );

    if (!totalCheck.allowed) {
      healthFiltered.push(
        buildProviderSnapshot(provider, groupFilter, {
          details: totalCheck.reason || "total_cost_limit_reached",
        })
      );
      continue;
    }

    healthyProviders.push(provider);
  }

  steps.push(
    buildStep("healthAndLimits", 6, currentProviders, healthyProviders, healthFiltered, groupFilter)
  );
  currentProviders = healthyProviders;

  const priorityTiers = await buildPriorityTiers(
    currentProviders,
    groupFilter,
    normalizedModelName
  );
  const selectedPriority = priorityTiers.find((tier) => tier.isSelected)?.priority ?? null;
  const selectedPriorityProviders = priorityTiers.find((tier) => tier.isSelected)?.providers ?? [];
  const selectedPriorityProviderIds = new Set(
    selectedPriorityProviders.map((provider) => provider.id)
  );

  steps.push({
    stepName: "priorityTiers",
    stepIndex: 7,
    inputCount: currentProviders.length,
    outputCount: selectedPriorityProviders.length,
    filteredOut: currentProviders
      .filter((provider) => !selectedPriorityProviderIds.has(provider.id))
      .map((provider) =>
        buildProviderSnapshot(provider, groupFilter, {
          details: `effective_priority=${ProxyProviderResolver.resolveEffectivePriority(provider, groupFilter)}`,
        })
      ),
    surviving: currentProviders
      .filter((provider) => selectedPriorityProviderIds.has(provider.id))
      .map((provider) =>
        buildProviderSnapshot(provider, groupFilter, {
          redirectedModel: normalizedModelName
            ? getProviderModelRedirectTarget(normalizedModelName, provider.modelRedirects)
            : null,
        })
      ),
  });

  currentProviders = currentProviders.filter((provider) => selectedPriorityProviderIds.has(provider.id));

  const redirectedProviders = currentProviders.map((provider) =>
    buildProviderSnapshot(provider, groupFilter, {
      redirectedModel: normalizedModelName
        ? getProviderModelRedirectTarget(normalizedModelName, provider.modelRedirects)
        : null,
      details:
        normalizedModelName === ""
          ? "no_model_name_provided"
          : getProviderModelRedirectTarget(normalizedModelName, provider.modelRedirects) !==
              normalizedModelName
            ? "redirect_rule_matched"
            : "no_redirect_rule_matched",
    })
  );
  steps.push({
    stepName: "modelRedirect",
    stepIndex: 8,
    inputCount: currentProviders.length,
    outputCount: currentProviders.length,
    filteredOut: [],
    surviving: redirectedProviders,
    note:
      normalizedModelName === ""
        ? "redirect_preview_skipped_for_resource_request"
        : "redirects_apply_after_provider_selection",
  });

  const endpointAnnotatedProviders = await Promise.all(
    currentProviders.map(async (provider) =>
      buildProviderSnapshot(provider, groupFilter, {
        endpointStats: await getEndpointStats(provider),
        details: "endpoint_pool_is_reported_as_downstream_risk_only",
      })
    )
  );
  steps.push({
    stepName: "endpointSummary",
    stepIndex: 9,
    inputCount: currentProviders.length,
    outputCount: currentProviders.length,
    filteredOut: [],
    surviving: endpointAnnotatedProviders,
    note: "endpoint_status_does_not_change_provider_preselection",
  });

  return {
    steps,
    priorityTiers,
    totalProviders: providers.length,
    finalCandidateCount: selectedPriorityProviders.length,
    selectedPriority,
  };
}

export async function simulateDispatchAction(
  rawInput: DispatchSimulatorInput
): Promise<ActionResult<DispatchSimulatorResult>> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return {
      ok: false,
      error: DISPATCH_SIMULATOR_ERROR_CODES.PERMISSION_DENIED,
      errorCode: DISPATCH_SIMULATOR_ERROR_CODES.PERMISSION_DENIED,
    };
  }

  const parsedInput = DispatchSimulatorInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    return {
      ok: false,
      error: DISPATCH_SIMULATOR_ERROR_CODES.INVALID_INPUT,
      errorCode: DISPATCH_SIMULATOR_ERROR_CODES.INVALID_INPUT,
      errorParams: { field: "dispatch_simulator" },
    };
  }

  try {
    const providers = await findAllProvidersFresh();
    const result = await simulateDispatchDecisionTree(providers, parsedInput.data);
    return { ok: true, data: result };
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : DISPATCH_SIMULATOR_ERROR_CODES.OPERATION_FAILED;
    return {
      ok: false,
      error: message,
      errorCode: DISPATCH_SIMULATOR_ERROR_CODES.OPERATION_FAILED,
    };
  }
}
