import { getRedisClient } from "@/lib/redis";
import { normalizeSiteTitle } from "@/lib/site-title";
import {
  buildPublicStatusConfigSnapshotKey,
  buildPublicStatusConfigVersionPointerKey,
  buildPublicStatusInternalConfigSnapshotKey,
  LEGACY_PUBLIC_STATUS_REDIS_PREFIX,
} from "./redis-contract";

export const DEFAULT_PUBLIC_STATUS_SITE_DESCRIPTION = "Request-derived public status";

/**
 * TTL (seconds) applied to *versioned* config snapshot keys written by this
 * module — i.e. versioned public-status config keys and the internal variant.
 *
 * 30 days matches `GENERATION_PROJECTION_TTL_SECONDS` in `rebuild-worker.ts`,
 * which already governs the manifest / series / snapshot keys for this
 * feature. These keys accumulate forever otherwise, since every config
 * publication mints a new version (provider/group/system-settings changes).
 *
 * The three *current-pointer* keys
 * (`buildPublicStatusConfigSnapshotKey()` with no argument,
 * `buildPublicStatusInternalConfigSnapshotKey()` with no argument, and
 * `buildPublicStatusConfigVersionPointerKey()`) are intentionally written
 * WITHOUT a TTL — they always reference the latest config and are
 * overwritten atomically on every publish, so they never accumulate. Giving
 * them a TTL would dark out the public status page on any deployment that
 * goes longer than the TTL without publishing (e.g. an idle staging env or
 * a stable production whose config does not change for a month).
 */
export const PUBLIC_STATUS_CONFIG_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface PublicStatusModelSnapshot {
  publicModelKey: string;
  label: string;
  vendorIconKey: string;
  requestTypeBadge: string;
}

export interface PublicStatusGroupSnapshot {
  slug: string;
  displayName: string;
  sortOrder: number;
  description: string | null;
  models: PublicStatusModelSnapshot[];
}

export interface InternalPublicStatusGroupSnapshot extends PublicStatusGroupSnapshot {
  sourceGroupId?: number | null;
  sourceGroupName: string;
}

export interface PublicStatusConfigSnapshot {
  configVersion: string;
  generatedAt: string;
  siteTitle: string;
  siteDescription: string;
  timeZone: string | null;
  defaultIntervalMinutes: number;
  defaultRangeHours: number;
  groups: PublicStatusGroupSnapshot[];
}

export interface InternalPublicStatusConfigSnapshot
  extends Omit<PublicStatusConfigSnapshot, "groups"> {
  groups: InternalPublicStatusGroupSnapshot[];
}

interface BuildPublicStatusConfigSnapshotInput {
  configVersion: string;
  siteTitle: string;
  siteDescription: string;
  timeZone?: string | null;
  defaultIntervalMinutes: number;
  defaultRangeHours: number;
  groups: Array<{
    slug: string;
    displayName: string;
    sortOrder: number;
    description: string | null;
    models: Array<{
      publicModelKey: string;
      label: string;
      vendorIconKey: string;
      requestTypeBadge: string;
      internalProviderName?: string;
      endpointUrl?: string;
    }>;
  }>;
}

interface RedisWriter {
  // ioredis supports both bare `set(key, value)` and the EX-variant
  // `set(key, value, "EX", seconds)`. Widening the type here lets us pass
  // an explicit TTL on every write — see PUBLIC_STATUS_CONFIG_TTL_SECONDS.
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown> | unknown;
  set(key: string, value: string): Promise<unknown> | unknown;
  get?(key: string): Promise<string | null> | string | null;
  eval?(script: string, numKeys: number, ...args: string[]): Promise<unknown> | unknown;
}

interface RedisReader {
  get(key: string): Promise<string | null> | string | null;
  status?: string;
}

interface ReadCurrentSnapshotOptions {
  redis?: RedisReader | null;
  allowLegacyFallback?: boolean;
}

function normalizePublicSiteDescription(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolvePublicStatusSiteDescription(input: {
  siteTitle?: unknown;
  siteDescription?: unknown;
}): string {
  const description = normalizePublicSiteDescription(input.siteDescription);
  if (description) {
    return description;
  }

  const siteTitle = normalizeSiteTitle(input.siteTitle);
  if (siteTitle) {
    return `${siteTitle} public status`;
  }

  return DEFAULT_PUBLIC_STATUS_SITE_DESCRIPTION;
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function safeGet(redis: RedisReader, key: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

function extractCurrentConfigVersion(pointerRaw: string | null): string | null {
  if (!pointerRaw) {
    return null;
  }

  if (pointerRaw.startsWith("cfg-")) {
    return pointerRaw;
  }

  const pointer = safeParseJson<{ key?: string; configVersion?: string }>(pointerRaw);
  if (pointer?.configVersion) {
    return pointer.configVersion;
  }
  if (pointer?.key) {
    const match = pointer.key.match(/:config(?:-internal)?:([^:]+)$/);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

export function buildPublicStatusConfigSnapshot(
  input: BuildPublicStatusConfigSnapshotInput
): PublicStatusConfigSnapshot {
  // 这里只保留 public-safe 字段，避免后续页面/路由再去查价格表或内部 provider 元数据。
  return {
    configVersion: input.configVersion,
    generatedAt: new Date().toISOString(),
    siteTitle: input.siteTitle.trim(),
    siteDescription: resolvePublicStatusSiteDescription({
      siteTitle: input.siteTitle,
      siteDescription: input.siteDescription,
    }),
    timeZone: input.timeZone ?? null,
    defaultIntervalMinutes: input.defaultIntervalMinutes,
    defaultRangeHours: input.defaultRangeHours,
    groups: input.groups
      .toSorted(
        (left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug)
      )
      .map((group) => ({
        slug: group.slug,
        displayName: group.displayName,
        sortOrder: group.sortOrder,
        description: group.description,
        models: group.models.map((model) => ({
          publicModelKey: model.publicModelKey,
          label: model.label,
          vendorIconKey: model.vendorIconKey,
          requestTypeBadge: model.requestTypeBadge,
        })),
      })),
  };
}

export async function publishPublicStatusConfigSnapshot(input: {
  reason: string;
  snapshot?: PublicStatusConfigSnapshot;
  redis?: RedisWriter | null;
  setCurrentPointer?: boolean;
}): Promise<{
  configVersion: string;
  key: string;
  written: boolean;
}> {
  const snapshot =
    input.snapshot ??
    buildPublicStatusConfigSnapshot({
      configVersion: `cfg-${Date.now()}`,
      siteTitle: "Claude Code Hub Status",
      siteDescription: DEFAULT_PUBLIC_STATUS_SITE_DESCRIPTION,
      timeZone: null,
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [],
    });

  const key = buildPublicStatusConfigSnapshotKey(snapshot.configVersion);
  const redis = input.redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });

  if (redis) {
    // Versioned snapshot key: TTL'd so old versions get cleaned up.
    await redis.set(key, JSON.stringify(snapshot), "EX", PUBLIC_STATUS_CONFIG_TTL_SECONDS);
    if (input.setCurrentPointer !== false) {
      // Current-pointer key: no TTL. It is overwritten on every publish and
      // is the only entry-point the read path uses — see TTL constant above.
      await redis.set(
        buildPublicStatusConfigSnapshotKey(),
        JSON.stringify({ key, configVersion: snapshot.configVersion })
      );
    }
  }

  return {
    configVersion: snapshot.configVersion,
    key,
    written: Boolean(redis),
  };
}

export function buildInternalPublicStatusConfigSnapshot(
  input: Omit<InternalPublicStatusConfigSnapshot, "generatedAt">
): InternalPublicStatusConfigSnapshot {
  return {
    ...input,
    generatedAt: new Date().toISOString(),
    groups: Array.from(input.groups).toSorted(
      (left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug)
    ),
  };
}

export async function publishInternalPublicStatusConfigSnapshot(input: {
  snapshot: InternalPublicStatusConfigSnapshot;
  redis?: RedisWriter | null;
  setCurrentPointer?: boolean;
}): Promise<{ configVersion: string; key: string; written: boolean }> {
  const key = buildPublicStatusInternalConfigSnapshotKey(input.snapshot.configVersion);
  const redis = input.redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });

  if (redis) {
    // Versioned snapshot key: TTL'd so old versions get cleaned up.
    await redis.set(key, JSON.stringify(input.snapshot), "EX", PUBLIC_STATUS_CONFIG_TTL_SECONDS);
    if (input.setCurrentPointer !== false) {
      // Current-pointer key: no TTL — see TTL constant rationale above.
      await redis.set(
        buildPublicStatusInternalConfigSnapshotKey(),
        JSON.stringify({ key, configVersion: input.snapshot.configVersion })
      );
    }
  }

  return {
    configVersion: input.snapshot.configVersion,
    key,
    written: Boolean(redis),
  };
}

export async function publishCurrentPublicStatusConfigPointers(input: {
  configVersion: string;
  redis?: RedisWriter | null;
}): Promise<boolean> {
  const redis = input.redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis) {
    return false;
  }

  const pointerKey = buildPublicStatusConfigVersionPointerKey();
  // This is a current-pointer key: do NOT apply a TTL. It is overwritten on
  // every successful publish; an idle deployment with no config change for
  // longer than any TTL we would pick would otherwise lose the pointer and
  // dark out the public status page.
  if (typeof redis.eval === "function") {
    const luaScript = `
      local current = redis.call('GET', KEYS[1])
      if (not current) or current <= ARGV[1] then
        redis.call('SET', KEYS[1], ARGV[1])
        return 1
      end
      return 0
    `;
    const result = await redis.eval(luaScript, 1, pointerKey, input.configVersion);
    return result === 1;
  }

  const currentVersion =
    typeof redis.get === "function"
      ? extractCurrentConfigVersion(await redis.get(pointerKey))
      : null;
  if (currentVersion && currentVersion > input.configVersion) {
    return false;
  }

  await redis.set(pointerKey, input.configVersion);
  return true;
}

export async function readCurrentPublicStatusConfigSnapshot(input?: {
  redis?: RedisReader | null;
  allowLegacyFallback?: boolean;
}): Promise<PublicStatusConfigSnapshot | null> {
  const redis = input?.redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || ("status" in redis && redis.status && redis.status !== "ready")) {
    return null;
  }

  const prefixes =
    input?.allowLegacyFallback === false
      ? [undefined]
      : [undefined, LEGACY_PUBLIC_STATUS_REDIS_PREFIX];
  for (const prefix of prefixes) {
    const currentVersion = extractCurrentConfigVersion(
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- current prefix must be tried before legacy fallback
      await safeGet(redis, buildPublicStatusConfigVersionPointerKey({ prefix }))
    );
    if (currentVersion) {
      const snapshotRaw = await safeGet(
        redis,
        buildPublicStatusConfigSnapshotKey(currentVersion, { prefix })
      );
      const snapshot = safeParseJson<PublicStatusConfigSnapshot>(snapshotRaw);
      if (snapshot) {
        return snapshot;
      }
    }

    const pointerRaw = await safeGet(
      redis,
      buildPublicStatusConfigSnapshotKey("current", { prefix })
    );
    const pointer = safeParseJson<{ key?: string }>(pointerRaw);
    if (!pointer?.key) {
      continue;
    }
    const snapshot = safeParseJson<PublicStatusConfigSnapshot>(await safeGet(redis, pointer.key));
    if (snapshot) {
      return snapshot;
    }
  }

  return null;
}

export async function readCurrentInternalPublicStatusConfigSnapshot(
  input?: ReadCurrentSnapshotOptions
): Promise<InternalPublicStatusConfigSnapshot | null> {
  const redis = input?.redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || ("status" in redis && redis.status && redis.status !== "ready")) {
    return null;
  }

  const prefixes =
    input?.allowLegacyFallback === false
      ? [undefined]
      : [undefined, LEGACY_PUBLIC_STATUS_REDIS_PREFIX];
  for (const prefix of prefixes) {
    const currentVersion = extractCurrentConfigVersion(
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- current prefix must be tried before legacy fallback
      await safeGet(redis, buildPublicStatusConfigVersionPointerKey({ prefix }))
    );
    if (currentVersion) {
      const snapshotRaw = await safeGet(
        redis,
        buildPublicStatusInternalConfigSnapshotKey(currentVersion, { prefix })
      );
      const snapshot = safeParseJson<InternalPublicStatusConfigSnapshot>(snapshotRaw);
      if (snapshot) {
        return snapshot;
      }
    }

    const pointerRaw = await safeGet(
      redis,
      buildPublicStatusInternalConfigSnapshotKey("current", { prefix })
    );
    const pointer = safeParseJson<{ key?: string }>(pointerRaw);
    if (!pointer?.key) {
      continue;
    }
    const snapshot = safeParseJson<InternalPublicStatusConfigSnapshot>(
      await safeGet(redis, pointer.key)
    );
    if (snapshot) {
      return snapshot;
    }
  }

  return null;
}

export async function readPublicStatusSiteMetadata(input?: {
  redis?: RedisReader | null;
}): Promise<{
  siteTitle: string;
  siteDescription: string;
} | null> {
  const snapshot = await readCurrentPublicStatusConfigSnapshot(input);
  const siteTitle = normalizeSiteTitle(snapshot?.siteTitle);
  if (!siteTitle) {
    return null;
  }

  return {
    siteTitle,
    siteDescription: resolvePublicStatusSiteDescription({
      siteTitle,
      siteDescription: snapshot?.siteDescription,
    }),
  };
}

export async function readPublicStatusTimeZone(input?: {
  redis?: RedisReader | null;
}): Promise<string | null> {
  const snapshot = await readCurrentPublicStatusConfigSnapshot(input);
  return snapshot?.timeZone ?? null;
}
