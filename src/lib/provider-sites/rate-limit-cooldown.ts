const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_FALLBACK_COOLDOWN_MS = 60 * 60 * 1000;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const MIN_COOLDOWN_MS = 1000;

type PersistedRateLimit = {
  lastSyncAt?: Date | null;
  lastSyncError?: string | null;
};

export type ProviderSiteRateLimitCooldown = {
  untilMs: number;
  remainingMs: number;
  consecutive: number;
  source: "memory" | "persisted";
};

type CooldownState = Omit<ProviderSiteRateLimitCooldown, "remainingMs" | "source">;

const cooldowns = new Map<string, CooldownState>();

function normalizeSiteUrl(siteUrl: string): string {
  return siteUrl.trim().replace(/\/+$/, "").toLowerCase();
}

function isRateLimitError(error?: string | null): boolean {
  return /(?:\b429\b|rate.?limit)/i.test(error ?? "");
}

function persistedCooldownUntilMs(persistedAt: number, error?: string | null): number {
  const match = error?.match(/cooling down until\s+([^\s;]+)/i);
  const explicitUntilMs = match?.[1] ? Date.parse(match[1]) : Number.NaN;
  return Number.isFinite(explicitUntilMs) ? explicitUntilMs : persistedAt + DEFAULT_COOLDOWN_MS;
}

function clampRetryAfterMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_COOLDOWN_MS;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_COOLDOWN_MS, Math.ceil(value)));
}

function fallbackCooldownMs(consecutive: number): number {
  return Math.min(
    MAX_FALLBACK_COOLDOWN_MS,
    DEFAULT_COOLDOWN_MS * 2 ** Math.max(0, Math.min(consecutive - 1, 10))
  );
}

export function getProviderSiteRateLimitCooldown(
  siteUrl: string,
  persisted?: PersistedRateLimit,
  nowMs = Date.now()
): ProviderSiteRateLimitCooldown | null {
  const key = normalizeSiteUrl(siteUrl);
  const state = cooldowns.get(key);
  if (state) {
    if (state.untilMs > nowMs) {
      return {
        ...state,
        remainingMs: state.untilMs - nowMs,
        source: "memory",
      };
    }
    cooldowns.delete(key);
  }

  const persistedAt = persisted?.lastSyncAt?.getTime();
  if (
    persistedAt != null &&
    Number.isFinite(persistedAt) &&
    isRateLimitError(persisted?.lastSyncError)
  ) {
    const untilMs = persistedCooldownUntilMs(persistedAt, persisted?.lastSyncError);
    if (untilMs > nowMs) {
      return {
        untilMs,
        remainingMs: untilMs - nowMs,
        consecutive: 1,
        source: "persisted",
      };
    }
  }

  return null;
}

export function noteProviderSiteRateLimit(
  siteUrl: string,
  retryAfterMs?: number | null,
  nowMs = Date.now()
): ProviderSiteRateLimitCooldown {
  const key = normalizeSiteUrl(siteUrl);
  const previous = cooldowns.get(key);
  const consecutive = previous && previous.untilMs > nowMs ? previous.consecutive + 1 : 1;
  const waitMs =
    retryAfterMs != null ? clampRetryAfterMs(retryAfterMs) : fallbackCooldownMs(consecutive);
  const state: CooldownState = {
    untilMs: nowMs + waitMs,
    consecutive,
  };
  cooldowns.set(key, state);
  return {
    ...state,
    remainingMs: waitMs,
    source: "memory",
  };
}

export function clearProviderSiteRateLimit(siteUrl: string): void {
  cooldowns.delete(normalizeSiteUrl(siteUrl));
}

export function formatProviderSiteRateLimitCooldown(
  cooldown: ProviderSiteRateLimitCooldown
): string {
  return `upstream rate limited; site sync cooling down until ${new Date(cooldown.untilMs).toISOString()}`;
}

export function resetProviderSiteRateLimitCooldownsForTests(): void {
  cooldowns.clear();
}
