/**
 * Wall-clock aligned 5-minute refresher for provider site group rates + balance.
 */
import { logger } from "@/lib/logger";
import { syncAllEnabledProviderSitesFromUpstream } from "@/lib/provider-sites/sync-from-upstream";

const INTERVAL_MS = 5 * 60 * 1000;
const ENABLED = process.env.PROVIDER_SITE_RATE_SYNC_DISABLED !== "1";

type SchedulerState = {
  __CCH_PROVIDER_SITE_RATE_SYNC_STARTED__?: boolean;
  __CCH_PROVIDER_SITE_RATE_SYNC_STOP__?: boolean;
  __CCH_PROVIDER_SITE_RATE_SYNC_DISPATCHING__?: boolean;
  __CCH_PROVIDER_SITE_RATE_SYNC_TIMEOUT_ID__?: ReturnType<typeof setTimeout>;
  __CCH_PROVIDER_SITE_RATE_SYNC_INTERVAL_ID__?: ReturnType<typeof setInterval>;
};

const schedulerState = globalThis as typeof globalThis & SchedulerState;

function msUntilNextBoundary(nowMs: number, intervalMs: number): number {
  const rem = nowMs % intervalMs;
  return rem === 0 ? intervalMs : intervalMs - rem;
}

async function runCycle(): Promise<void> {
  if (schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_DISPATCHING__) return;
  schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_DISPATCHING__ = true;
  const started = Date.now();
  try {
    const results = await syncAllEnabledProviderSitesFromUpstream({ concurrency: 3 });
    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;
    const groups = results.reduce((sum, r) => sum + r.groupsUpserted, 0);
    logger.info("[ProviderSiteRateSync] cycle complete", {
      sites: results.length,
      ok,
      failed,
      groupsUpserted: groups,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    logger.warn("[ProviderSiteRateSync] cycle error", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_DISPATCHING__ = false;
  }
}

export function startProviderSiteRateSyncScheduler(): void {
  if (!ENABLED) {
    logger.info("[ProviderSiteRateSync] disabled by env PROVIDER_SITE_RATE_SYNC_DISABLED=1");
    return;
  }
  if (schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_STARTED__) return;

  schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_STOP__ = false;
  schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_STARTED__ = true;

  const delayMs = msUntilNextBoundary(Date.now(), INTERVAL_MS);
  logger.info("[ProviderSiteRateSync] Started (wall-clock 5m)", {
    intervalMs: INTERVAL_MS,
    firstFireInMs: delayMs,
  });

  // First run shortly after boot so empty sites get rates without waiting full 5m.
  setTimeout(() => {
    if (schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_STOP__) return;
    void runCycle();
  }, 15_000);

  schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_TIMEOUT_ID__ = setTimeout(() => {
    schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_TIMEOUT_ID__ = undefined;
    if (schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_STOP__) return;
    void runCycle();
    schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_INTERVAL_ID__ = setInterval(() => {
      void runCycle();
    }, INTERVAL_MS);
  }, delayMs);
}

export function stopProviderSiteRateSyncScheduler(): void {
  schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_STOP__ = true;
  const timeoutId = schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_TIMEOUT_ID__;
  if (timeoutId) clearTimeout(timeoutId);
  schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_TIMEOUT_ID__ = undefined;
  const intervalId = schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_INTERVAL_ID__;
  if (intervalId) clearInterval(intervalId);
  schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_INTERVAL_ID__ = undefined;
  schedulerState.__CCH_PROVIDER_SITE_RATE_SYNC_STARTED__ = false;
}

export async function runProviderSiteRateSyncOnce(): Promise<void> {
  await runCycle();
}
