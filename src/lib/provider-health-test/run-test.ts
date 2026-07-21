import "server-only";

import { GeminiAuth } from "@/app/v1/_lib/gemini/auth";
import { logger } from "@/lib/logger";
import {
  getDefaultHealthTestModel,
  isHealthTestDueForBucket,
  MANUAL_HEALTH_TEST_GEMINI_TIMEOUT_MS,
  MANUAL_HEALTH_TEST_TIMEOUT_MS,
  SCHEDULED_HEALTH_TEST_TIMEOUT_MS,
} from "@/lib/provider-health-test/defaults";
import { executeProviderTest } from "@/lib/provider-testing/test-service";
import type { ProviderTestConfig, ProviderTestResult, TokenUsage } from "@/lib/provider-testing/types";
import { calculateRequestCost } from "@/lib/utils/cost-calculation";
import { formatCostForStorage } from "@/lib/utils/currency";
import { findLatestPriceByModel } from "@/repository/model-price";
import {
  findProvidersForScheduledHealthTest,
  recordProviderHealthTestResult,
  type ProviderHealthTestSource,
  type ProviderHealthTestTarget,
} from "@/repository/provider-health-test";
import type { ProviderType } from "@/types/provider";

export interface RunProviderHealthTestInput {
  provider:
    | ProviderHealthTestTarget
    | {
        id: number;
        name: string;
        url: string;
        key: string;
        providerType: ProviderType;
        proxyUrl?: string | null;
        proxyFallbackToDirect?: boolean | null;
        customHeaders?: Record<string, string> | null;
        costMultiplier?: number | string | null;
      };
  source: ProviderHealthTestSource;
  model?: string;
}

/**
 * Per-provider in-flight guard for scheduled tests.
 * Slow providers only block themselves — they must not hold a global cycle lock
 * that would skip the next minute for fast providers.
 */
const scheduledInFlight = new Set<number>();

export function getScheduledHealthTestInFlightCount(): number {
  return scheduledInFlight.size;
}

export function getScheduledHealthTestInFlightIds(): number[] {
  return Array.from(scheduledInFlight);
}

async function resolveApiKey(
  providerType: ProviderType,
  key: string
): Promise<{ apiKey: string; geminiBearerAuth?: boolean }> {
  const isGemini = providerType === "gemini" || providerType === "gemini-cli";
  if (!isGemini) {
    return { apiKey: key };
  }

  try {
    const apiKey = await GeminiAuth.getAccessToken(key);
    return {
      apiKey,
      geminiBearerAuth: GeminiAuth.isJson(key) || undefined,
    };
  } catch (error) {
    logger.warn("[ProviderHealthTest] gemini auth preprocess failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { apiKey: key };
  }
}

function parseCostMultiplier(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 1;
}

async function estimateHealthTestCostUsd(input: {
  model: string;
  usage?: TokenUsage;
  costMultiplier?: number | string | null;
}): Promise<{
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: string | null;
}> {
  const usage = input.usage;
  if (!usage) {
    return {
      inputTokens: null,
      outputTokens: null,
      cacheCreationInputTokens: null,
      cacheReadInputTokens: null,
      costUsd: null,
    };
  }

  const inputTokens = Number.isFinite(usage.inputTokens) ? Math.max(0, Math.round(usage.inputTokens)) : null;
  const outputTokens = Number.isFinite(usage.outputTokens)
    ? Math.max(0, Math.round(usage.outputTokens))
    : null;
  const cacheCreationInputTokens =
    typeof usage.cacheCreationInputTokens === "number" && Number.isFinite(usage.cacheCreationInputTokens)
      ? Math.max(0, Math.round(usage.cacheCreationInputTokens))
      : null;
  const cacheReadInputTokens =
    typeof usage.cacheReadInputTokens === "number" && Number.isFinite(usage.cacheReadInputTokens)
      ? Math.max(0, Math.round(usage.cacheReadInputTokens))
      : null;

  let costUsd: string | null = null;
  try {
    const price = await findLatestPriceByModel(input.model);
    if (price?.priceData) {
      const raw = calculateRequestCost(
        {
          input_tokens: inputTokens ?? 0,
          output_tokens: outputTokens ?? 0,
          cache_creation_input_tokens: cacheCreationInputTokens ?? 0,
          cache_read_input_tokens: cacheReadInputTokens ?? 0,
          cache_creation_5m_input_tokens: usage.cacheCreation5mInputTokens,
          cache_creation_1h_input_tokens: usage.cacheCreation1hInputTokens,
        },
        price.priceData,
        { multiplier: parseCostMultiplier(input.costMultiplier) }
      );
      costUsd = formatCostForStorage(raw);
    }
  } catch (error) {
    logger.debug("[ProviderHealthTest] cost estimate skipped", {
      model: input.model,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    costUsd,
  };
}

export async function runProviderHealthTest(
  input: RunProviderHealthTestInput
): Promise<ProviderTestResult> {
  const provider = input.provider;
  const isGemini =
    provider.providerType === "gemini" || provider.providerType === "gemini-cli";
  const { apiKey, geminiBearerAuth } = await resolveApiKey(provider.providerType, provider.key);
  // Scheduled: must use group-configured model (already filtered if missing).
  // Manual: allow override, else type default (manual still works without group model).
  const model =
    input.model?.trim() ||
    ("healthTestModel" in provider && provider.healthTestModel
      ? String(provider.healthTestModel).trim()
      : "") ||
    (input.source === "scheduled"
      ? ""
      : getDefaultHealthTestModel(provider.providerType));
  if (!model) {
    throw new Error("health_test_model_not_configured");
  }

  const config: ProviderTestConfig = {
    providerId: String(provider.id),
    providerUrl: provider.url,
    apiKey,
    providerType: provider.providerType,
    model,
    proxyUrl: provider.proxyUrl ?? undefined,
    proxyFallbackToDirect: provider.proxyFallbackToDirect ?? undefined,
    customHeaders: provider.customHeaders ?? undefined,
    geminiBearerAuth,
    timeoutMs:
      input.source === "manual"
        ? isGemini
          ? MANUAL_HEALTH_TEST_GEMINI_TIMEOUT_MS
          : MANUAL_HEALTH_TEST_TIMEOUT_MS
        : SCHEDULED_HEALTH_TEST_TIMEOUT_MS,
    // No first-token hard deadline for manual or scheduled — measure TTFB but
    // let slow first tokens finish within total timeout (avoids false 15s kills).
    firstByteTimeoutMs: undefined,
  };

  const result = await executeProviderTest(config);
  const resolvedModel = result.model ?? model;
  const cost = await estimateHealthTestCostUsd({
    model: resolvedModel,
    usage: result.usage,
    costMultiplier: "costMultiplier" in provider ? provider.costMultiplier : null,
  });

  await recordProviderHealthTestResult({
    providerId: provider.id,
    source: input.source,
    ok: result.success,
    status: result.status,
    model: resolvedModel,
    firstByteMs: result.firstByteMs ?? null,
    latencyMs: result.latencyMs ?? null,
    httpStatusCode: result.httpStatusCode ?? null,
    errorType: result.errorType ?? result.subStatus,
    errorMessage: result.errorMessage ?? null,
    inputTokens: cost.inputTokens,
    outputTokens: cost.outputTokens,
    cacheCreationInputTokens: cost.cacheCreationInputTokens,
    cacheReadInputTokens: cost.cacheReadInputTokens,
    costUsd: cost.costUsd,
  });

  return result;
}

async function runOneScheduledProvider(current: ProviderHealthTestTarget): Promise<boolean> {
  try {
    await runProviderHealthTest({ provider: current, source: "scheduled" });
    return true;
  } catch (error) {
    logger.warn("[ProviderHealthTest] scheduled run failed", {
      providerId: current.id,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await recordProviderHealthTestResult({
        providerId: current.id,
        source: "scheduled",
        ok: false,
        status: "red",
        model: current.healthTestModel || getDefaultHealthTestModel(current.providerType),
        errorType: "scheduler_error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // ignore secondary write failure
    }
    return false;
  } finally {
    scheduledInFlight.delete(current.id);
    // Each provider finishes on its own clock — refresh dispatch SLO promptly.
    try {
      const { publishProviderCacheInvalidation } = await import("@/lib/cache/provider-cache");
      await publishProviderCacheInvalidation();
    } catch (error) {
      logger.debug("[ProviderHealthTest] post-provider cache invalidate skipped", {
        providerId: current.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Start due scheduled health tests independently per provider.
 *
 * - Does NOT await all providers (no global wait on the slowest).
 * - Skips providers already in-flight so a long run cannot be double-started.
 * - Fast providers become due again next wall-clock bucket even if others are still running.
 */
export async function runDueScheduledHealthTests(options?: {
  intervalMs?: number;
  now?: Date;
}): Promise<{ due: number; started: number; skippedInFlight: number; inFlight: number }> {
  const intervalMs = options?.intervalMs ?? 60_000;
  const now = options?.now ?? new Date();
  const targets = await findProvidersForScheduledHealthTest();

  // Wall-clock buckets: once per minute boundary (or custom intervalMs).
  const dueCandidates = targets.filter((p) =>
    isHealthTestDueForBucket(p.lastHealthTestAt, now, intervalMs)
  );

  let skippedInFlight = 0;
  const toStart: ProviderHealthTestTarget[] = [];
  for (const p of dueCandidates) {
    if (scheduledInFlight.has(p.id)) {
      skippedInFlight += 1;
      continue;
    }
    toStart.push(p);
  }

  if (toStart.length === 0) {
    return {
      due: dueCandidates.length,
      started: 0,
      skippedInFlight,
      inFlight: scheduledInFlight.size,
    };
  }

  // Mark in-flight before yielding so a concurrent minute tick cannot double-start.
  for (const current of toStart) {
    scheduledInFlight.add(current.id);
  }

  // Fire-and-forget: each provider has its own timer; scheduler cycle returns immediately.
  for (const current of toStart) {
    void runOneScheduledProvider(current);
  }

  return {
    due: dueCandidates.length,
    started: toStart.length,
    skippedInFlight,
    inFlight: scheduledInFlight.size,
  };
}
