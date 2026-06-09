import { getLocale } from "next-intl/server";
import { BucketRateLimitService } from "@/lib/model-rate-limit/bucket-service";
import { resolveModelLimits } from "@/lib/model-rate-limit/cache";
import { isModelRateLimitEnabled, type LimitWindow } from "@/lib/model-rate-limit/types";
import { ERROR_CODES, getErrorMessageServer } from "@/lib/utils/error-messages";
import { RateLimitError } from "./errors";
import type { GuardStep } from "./guard-pipeline";
import { ModelRedirector } from "./model-redirector";
import type { ProxySession } from "./session";

type RateLimitErrorType = ConstructorParameters<typeof RateLimitError>[2];

const WINDOW_ERROR_MAP: Record<LimitWindow, { code: string; limitType: RateLimitErrorType }> = {
  "5h": { code: ERROR_CODES.MODEL_RATE_LIMIT_5H_EXCEEDED, limitType: "usd_5h" },
  daily: { code: ERROR_CODES.MODEL_RATE_LIMIT_DAILY_QUOTA_EXCEEDED, limitType: "daily_quota" },
  weekly: { code: ERROR_CODES.MODEL_RATE_LIMIT_WEEKLY_EXCEEDED, limitType: "usd_weekly" },
  monthly: { code: ERROR_CODES.MODEL_RATE_LIMIT_MONTHLY_EXCEEDED, limitType: "usd_monthly" },
  total: { code: ERROR_CODES.MODEL_RATE_LIMIT_TOTAL_EXCEEDED, limitType: "usd_total" },
};

/**
 * Group-rate-limit guard (用户组 × 模型组). Runs *after* `provider` so the
 * upstream model name (post-redirect) can be derived from the selected
 * provider's `modelRedirects`, and *before* the mainline `rateLimit` step so
 * it can set the per-axis complete-split flags that the mainline cost gates
 * read (§5.2). When the request's effective upstream model belongs to no
 * configured group, resolution returns [] and this is a no-op — preserving
 * mainline behavior (D9).
 *
 * The lookup uses the redirect target rather than the client-requested name so
 * that the group lookup namespace matches `usage_ledger.model` (which records
 * the upstream model). Looking up by the client name would let aliased
 * requests (e.g. `claude-haiku-4-5-20251001 → glm-4.7`) skip the group gate
 * while their cost still aggregates into the group bucket.
 *
 * For each resolved bucket the guard checks all cost windows. A violation
 * throws a `MODEL_*` RateLimitError. On a clean pass it sets the matching
 * `bypass{User,Key}GlobalCost` flag so the mainline global gate for that axis
 * is skipped and the consumption is excluded from that axis's global
 * aggregation (complete split, §5.3).
 *
 * CRITICAL (§5.2): a fail-open bucket (Redis/DB unavailable, `result.failOpen`)
 * must NOT set bypass — otherwise the model gate did not enforce AND the
 * mainline gate is bypassed, opening the cost gate entirely. Fail-open keeps
 * the mainline global gate as the backstop.
 */
/**
 * bugfix #02: shared resolve+check pipeline reused by both the initial guard
 * execution and the provider-change listener. `throwOnViolation` is true on the
 * synchronous guard path (so a group-quota breach short-circuits the request)
 * and false on the re-resolve path (because a failover-time violation cannot
 * abort the in-flight upstream call — the worst case is that the model bucket
 * lease decrements past zero on settle, which the bucket service tolerates).
 */
/**
 * Effective upstream model for the currently-bound provider. Prefers the
 * session's own derived getter when available (real ProxySession), and falls
 * back to inline derivation for legacy mocks that only expose
 * `getCurrentModel()` / `provider`.
 */
function effectiveUpstreamModel(session: ProxySession): string | null {
  const maybe = (session as unknown as { getEffectiveUpstreamModel?: () => string | null })
    .getEffectiveUpstreamModel;
  if (typeof maybe === "function") {
    return maybe.call(session);
  }
  const client = session.getCurrentModel();
  if (!client) return null;
  return session.provider ? ModelRedirector.getRedirectedModel(client, session.provider) : client;
}

async function resolveAndApplyForCurrentProvider(
  session: ProxySession,
  options: { throwOnViolation: boolean; resetOnEmpty: boolean }
): Promise<void> {
  const user = session.authState?.user;
  if (!user) return;

  const model = effectiveUpstreamModel(session);
  if (!model) return;

  const key = session.authState?.key;
  const buckets = await resolveModelLimits({
    userId: user.id,
    keyId: key?.id,
    model,
    tags: user.tags ?? [],
    now: new Date(),
  });

  if (buckets.length === 0) {
    if (options.resetOnEmpty) {
      // Re-resolve path: a stale bucket set from the previous provider must
      // not leak into ledger writes. Initial path stays a no-op (D9: model in
      // no group → mainline parity).
      session.setResolvedModelLimits([]);
      session.setBypassUserGlobalCost(false);
      session.setBypassKeyGlobalCost(false);
    }
    return;
  }

  session.setResolvedModelLimits(buckets);
  if (options.resetOnEmpty) {
    // Re-resolve path always resets bypass before recomputing so a previous
    // provider's split state cannot bleed into the new provider.
    session.setBypassUserGlobalCost(false);
    session.setBypassKeyGlobalCost(false);
  }

  const checks = await Promise.all(
    buckets.map(async (bucket) => ({
      bucket,
      result: await BucketRateLimitService.checkCostLimits(bucket),
    }))
  );

  const violation = checks.find(({ result }) => !result.allowed);
  if (violation) {
    if (!options.throwOnViolation) {
      // Re-resolve path: log only. The in-flight forwarder run already committed
      // to the new provider; the bucket lease decrement at settle will reflect
      // the overshoot. Mainline global gate stays in effect for safety.
      return;
    }
    const { result } = violation;
    const { code, limitType } = WINDOW_ERROR_MAP[result.window ?? "total"];
    const current = result.currentUsage ?? 0;
    const limitValue = result.limitValue ?? 0;
    const locale = await getLocale();
    const message = await getErrorMessageServer(locale, code, {
      model,
      current: current.toFixed(4),
      limit: limitValue.toFixed(4),
    });
    throw new RateLimitError(
      "rate_limit_error",
      message,
      limitType,
      current,
      limitValue,
      null,
      null
    );
  }

  for (const { bucket, result } of checks) {
    if (result.failOpen) continue;
    if (bucket.axis === "user") session.setBypassUserGlobalCost(true);
    else session.setBypassKeyGlobalCost(true);
  }
}

export const ModelRateLimitGuard: GuardStep = {
  name: "modelRateLimit",
  async execute(session: ProxySession): Promise<Response | null> {
    if (!isModelRateLimitEnabled()) return null;

    // bugfix #02: register the re-resolve listener BEFORE the initial run so
    // any subsequent `await session.changeProvider(...)` from the forwarder
    // recomputes buckets + bypass flags against the final provider. Optional
    // wiring: legacy unit-test fakes that don't expose the API are tolerated.
    const listenerSetter = (
      session as unknown as {
        setProviderChangeListener?: (cb: (s: ProxySession) => Promise<void> | void) => void;
      }
    ).setProviderChangeListener;
    if (typeof listenerSetter === "function") {
      listenerSetter.call(session, (s: ProxySession) =>
        resolveAndApplyForCurrentProvider(s, { throwOnViolation: false, resetOnEmpty: true })
      );
    }

    await resolveAndApplyForCurrentProvider(session, {
      throwOnViolation: true,
      resetOnEmpty: false,
    });
    return null;
  },
};
