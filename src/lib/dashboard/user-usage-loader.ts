import type { KeyUsageData } from "@/lib/api-client/v1/actions/users";

export const USER_USAGE_IDLE_DELAY_MS = 250;

interface LoadUserUsagePagesSequentiallyParams {
  pageUserIds: number[][];
  signal: AbortSignal;
  idleDelayMs?: number;
  fetchUsagePage: (userIds: number[]) => Promise<Record<number, KeyUsageData>>;
  onPageLoaded: (usageByKeyId: Record<number, KeyUsageData>) => void;
}

function waitForIdleWindow(delayMs: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const handleAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", handleAbort);
      resolve(false);
    };

    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve(true);
    }, delayMs);

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

export async function loadUserUsagePagesSequentially({
  pageUserIds,
  signal,
  idleDelayMs = USER_USAGE_IDLE_DELAY_MS,
  fetchUsagePage,
  onPageLoaded,
}: LoadUserUsagePagesSequentiallyParams): Promise<void> {
  const canStart = await waitForIdleWindow(idleDelayMs, signal);
  if (!canStart) {
    return;
  }

  for (const userIds of pageUserIds) {
    if (signal.aborted || userIds.length === 0) {
      if (signal.aborted) {
        return;
      }
      continue;
    }

    const usageByKeyId = await fetchUsagePage(userIds);
    if (signal.aborted) {
      return;
    }

    if (Object.keys(usageByKeyId).length > 0) {
      onPageLoaded(usageByKeyId);
    }
  }
}
