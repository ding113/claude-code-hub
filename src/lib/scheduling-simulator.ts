import type { ClientFormat } from "@/app/v1/_lib/proxy/format-mapper";
import {
  checkFormatProviderTypeCompatibility,
  checkProviderGroupMatch,
} from "@/app/v1/_lib/proxy/provider-selector";
import { getCircuitState, isCircuitOpen } from "@/lib/circuit-breaker";
import { modelMatchesAllowedRules } from "@/lib/provider-allowed-models";
import { getProviderModelRedirectTarget } from "@/lib/provider-model-redirects";
import { isProviderActiveNow } from "@/lib/utils/provider-schedule";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import type { Provider } from "@/types/provider";

// ---- Types ----

export interface SchedulingSimulationInput {
  format: ClientFormat;
  model: string;
  groups: string[];
}

export interface SimulationProviderInfo {
  id: number;
  name: string;
  providerType: string;
}

export interface SimulationStepFailed extends SimulationProviderInfo {
  reason: string;
  details: string;
}

export interface SimulationStep {
  name: string;
  description: string;
  inputCount: number;
  outputCount: number;
  passed: SimulationProviderInfo[];
  failed: SimulationStepFailed[];
}

export interface PriorityLevelProvider {
  id: number;
  name: string;
  providerType: string;
  weight: number;
  probability: number;
  redirectedModel: string | null;
}

export interface PriorityLevel {
  priority: number;
  providers: PriorityLevelProvider[];
}

export interface SimulationSummary {
  total: number;
  afterGroup: number;
  afterBasic: number;
  afterHealth: number;
  final: number;
}

export interface SchedulingSimulationResult {
  steps: SimulationStep[];
  priorityLevels: PriorityLevel[];
  summary: SimulationSummary;
}

// ---- Helpers ----

function toProviderInfo(p: Provider): SimulationProviderInfo {
  return { id: p.id, name: p.name, providerType: p.providerType };
}

// ---- Core Simulation ----

/**
 * 模拟供应商调度决策链
 *
 * 按照 provider-selector.ts 的 6 步过滤流程逐步模拟，
 * 记录每一步的通过/淘汰供应商及原因。
 * 跳过 Step 2（客户端限制）因为模拟场景无客户端上下文。
 */
export async function simulateProviderScheduling(
  input: SchedulingSimulationInput,
  allProviders: Provider[]
): Promise<SchedulingSimulationResult> {
  const steps: SimulationStep[] = [];
  let currentPool = [...allProviders];

  const summary: SimulationSummary = {
    total: allProviders.length,
    afterGroup: 0,
    afterBasic: 0,
    afterHealth: 0,
    final: 0,
  };

  // -- Step 1: Group pre-filter --
  {
    const passed: SimulationProviderInfo[] = [];
    const failed: SimulationStepFailed[] = [];
    const inputCount = currentPool.length;

    if (input.groups.length > 0) {
      const nextPool: Provider[] = [];
      const userGroupsString = input.groups.join(",");
      for (const p of currentPool) {
        if (checkProviderGroupMatch(p.groupTag, userGroupsString)) {
          passed.push(toProviderInfo(p));
          nextPool.push(p);
        } else {
          failed.push({
            ...toProviderInfo(p),
            reason: "group_mismatch",
            details: `groupTag: ${p.groupTag ?? "(none)"}`,
          });
        }
      }
      currentPool = nextPool;
    } else {
      // No group filter: all pass
      for (const p of currentPool) {
        passed.push(toProviderInfo(p));
      }
    }

    summary.afterGroup = currentPool.length;
    steps.push({
      name: "group_filter",
      description: "Filter by provider group tags",
      inputCount,
      outputCount: currentPool.length,
      passed,
      failed,
    });
  }

  // -- Step 2: Basic filtering (enabled + schedule + format + model whitelist) --
  {
    const passed: SimulationProviderInfo[] = [];
    const failed: SimulationStepFailed[] = [];
    const inputCount = currentPool.length;
    const systemTimezone = await resolveSystemTimezone();
    const nextPool: Provider[] = [];

    for (const p of currentPool) {
      // Enabled check
      if (!p.isEnabled) {
        failed.push({ ...toProviderInfo(p), reason: "disabled", details: "" });
        continue;
      }

      // Schedule check
      if (!isProviderActiveNow(p.activeTimeStart, p.activeTimeEnd, systemTimezone)) {
        failed.push({
          ...toProviderInfo(p),
          reason: "schedule_inactive",
          details: `${p.activeTimeStart ?? "?"}-${p.activeTimeEnd ?? "?"}`,
        });
        continue;
      }

      // Format compatibility
      if (!checkFormatProviderTypeCompatibility(input.format, p.providerType)) {
        failed.push({
          ...toProviderInfo(p),
          reason: "format_type_mismatch",
          details: `${input.format} vs ${p.providerType}`,
        });
        continue;
      }

      // Model whitelist
      if (input.model && !modelMatchesAllowedRules(input.model, p.allowedModels)) {
        failed.push({
          ...toProviderInfo(p),
          reason: "model_not_allowed",
          details: input.model,
        });
        continue;
      }

      passed.push(toProviderInfo(p));
      nextPool.push(p);
    }

    currentPool = nextPool;
    summary.afterBasic = currentPool.length;
    steps.push({
      name: "basic_filter",
      description: "Filter by enabled, schedule, format, model whitelist",
      inputCount,
      outputCount: currentPool.length,
      passed,
      failed,
    });
  }

  // -- Step 3: Health/limits (circuit breaker) --
  {
    const passed: SimulationProviderInfo[] = [];
    const failed: SimulationStepFailed[] = [];
    const inputCount = currentPool.length;
    const nextPool: Provider[] = [];

    // Check circuit breaker states in parallel
    const checks = await Promise.all(
      currentPool.map(async (p) => {
        const providerOpen = await isCircuitOpen(p.id);
        const state = getCircuitState(p.id);
        return { provider: p, providerOpen, state };
      })
    );

    for (const { provider: p, providerOpen, state } of checks) {
      if (providerOpen) {
        failed.push({
          ...toProviderInfo(p),
          reason: "circuit_open",
          details: state === "half-open" ? "circuit_half_open" : "circuit_open",
        });
      } else {
        passed.push(toProviderInfo(p));
        nextPool.push(p);
      }
    }

    currentPool = nextPool;
    summary.afterHealth = currentPool.length;
    steps.push({
      name: "health_filter",
      description: "Filter by circuit breaker and rate limits",
      inputCount,
      outputCount: currentPool.length,
      passed,
      failed,
    });
  }

  // -- Step 4 & 5: Priority + Weight --
  const priorityLevels: PriorityLevel[] = [];

  if (currentPool.length > 0) {
    // Group by effective priority
    const priorityMap = new Map<number, Provider[]>();
    for (const p of currentPool) {
      const effectivePriority = resolveLocalEffectivePriority(p, input.groups);
      const group = priorityMap.get(effectivePriority) ?? [];
      group.push(p);
      priorityMap.set(effectivePriority, group);
    }

    // Sort by priority (ascending = higher priority)
    const sortedPriorities = [...priorityMap.entries()].sort((a, b) => a[0] - b[0]);

    for (const [priority, providers] of sortedPriorities) {
      const totalWeight = providers.reduce((sum, p) => sum + (p.weight ?? 1), 0);

      const levelProviders: PriorityLevelProvider[] = providers.map((p) => {
        const weight = p.weight ?? 1;
        const redirected = getProviderModelRedirectTarget(input.model, p.modelRedirects);
        return {
          id: p.id,
          name: p.name,
          providerType: p.providerType,
          weight,
          probability: totalWeight > 0 ? weight / totalWeight : 0,
          redirectedModel: redirected !== input.model ? redirected : null,
        };
      });

      priorityLevels.push({ priority, providers: levelProviders });
    }
  }

  // Priority step
  {
    const passed: SimulationProviderInfo[] = currentPool.map(toProviderInfo);
    steps.push({
      name: "priority_selection",
      description: "Group by effective priority level",
      inputCount: currentPool.length,
      outputCount: currentPool.length,
      passed,
      failed: [],
    });
  }

  // Weight step
  {
    const topTierCount = priorityLevels.length > 0 ? priorityLevels[0].providers.length : 0;
    const topTierPassed =
      priorityLevels.length > 0
        ? priorityLevels[0].providers.map((p) => ({
            id: p.id,
            name: p.name,
            providerType: p.providerType,
          }))
        : [];

    summary.final = topTierCount;
    steps.push({
      name: "weight_selection",
      description: "Weighted random selection within top priority",
      inputCount: currentPool.length,
      outputCount: topTierCount,
      passed: topTierPassed,
      failed: [],
    });
  }

  return { steps, priorityLevels, summary };
}

// ---- Local helpers ----

/**
 * Resolve effective priority for a provider given user groups.
 * Mirrors ProxyProviderResolver.resolveEffectivePriority but without class dependency.
 */
function resolveLocalEffectivePriority(provider: Provider, groups: string[]): number {
  if (provider.groupPriorities && groups.length > 0) {
    // Find the lowest (highest priority) group-specific priority
    let minGroupPriority: number | null = null;
    for (const group of groups) {
      const gp = provider.groupPriorities[group];
      if (gp !== undefined && gp !== null) {
        if (minGroupPriority === null || gp < minGroupPriority) {
          minGroupPriority = gp;
        }
      }
    }
    if (minGroupPriority !== null) {
      return minGroupPriority;
    }
  }
  return provider.priority ?? 0;
}
