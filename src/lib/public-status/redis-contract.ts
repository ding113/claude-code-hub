import { createHash } from "node:crypto";

const PUBLIC_STATUS_REDIS_PREFIX = "public-status:v1";

export type PublicStatusServeState = "fresh" | "stale" | "rebuilding" | "no-data";

export interface PublicStatusManifest {
  configVersion: string;
  intervalMinutes: number;
  rangeHours: number;
  generation: string;
  sourceGeneration: string;
  coveredFrom: string;
  coveredTo: string;
  generatedAt: string;
  freshUntil: string;
  rebuildState: "idle" | "rebuilding";
  lastCompleteGeneration: string | null;
}

export interface PublicStatusManifestResolution {
  rebuildState: PublicStatusServeState;
  sourceGeneration: string | null;
  lastCompleteGeneration: string | null;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function encodeKeyPart(value: string | number): string {
  return encodeURIComponent(String(value));
}

export function alignBucketStartUtc(isoTimestamp: string, intervalMinutes: number): string {
  assertPositiveInteger(intervalMinutes, "intervalMinutes");

  const timestampMs = Date.parse(isoTimestamp);
  if (Number.isNaN(timestampMs)) {
    throw new Error(`Invalid ISO timestamp: ${isoTimestamp}`);
  }

  const bucketMs = intervalMinutes * 60 * 1000;
  const alignedMs = Math.floor(timestampMs / bucketMs) * bucketMs;
  return new Date(alignedMs).toISOString();
}

export function buildGenerationFingerprint(input: {
  configVersion: string;
  intervalMinutes: number;
  coveredFromIso: string;
  coveredToIso: string;
}): string {
  assertPositiveInteger(input.intervalMinutes, "intervalMinutes");

  const fingerprint = [
    input.configVersion,
    String(input.intervalMinutes),
    alignBucketStartUtc(input.coveredFromIso, input.intervalMinutes),
    alignBucketStartUtc(input.coveredToIso, input.intervalMinutes),
  ].join("|");

  return createHash("sha1").update(fingerprint).digest("hex").slice(0, 16);
}

export function buildPublicStatusConfigSnapshotKey(configVersion = "current"): string {
  return `${PUBLIC_STATUS_REDIS_PREFIX}:config:${encodeKeyPart(configVersion)}`;
}

export function buildPublicStatusInternalConfigSnapshotKey(configVersion = "current"): string {
  return `${PUBLIC_STATUS_REDIS_PREFIX}:config-internal:${encodeKeyPart(configVersion)}`;
}

export function buildPublicStatusConfigVersionPointerKey(): string {
  return `${PUBLIC_STATUS_REDIS_PREFIX}:config-version:current`;
}

export function buildPublicStatusManifestKey(input: {
  configVersion: string;
  intervalMinutes: number;
  rangeHours: number;
}): string {
  assertPositiveInteger(input.intervalMinutes, "intervalMinutes");
  assertPositiveInteger(input.rangeHours, "rangeHours");
  return [
    PUBLIC_STATUS_REDIS_PREFIX,
    "manifest",
    encodeKeyPart(input.configVersion),
    `${input.intervalMinutes}m`,
    `${input.rangeHours}h`,
  ].join(":");
}

export function buildPublicStatusCurrentSnapshotKey(input: {
  intervalMinutes: number;
  rangeHours: number;
  generation: string;
}): string {
  assertPositiveInteger(input.intervalMinutes, "intervalMinutes");
  assertPositiveInteger(input.rangeHours, "rangeHours");
  return [
    PUBLIC_STATUS_REDIS_PREFIX,
    "snapshot",
    encodeKeyPart(input.generation),
    `${input.intervalMinutes}m`,
    `${input.rangeHours}h`,
  ].join(":");
}

export function buildPublicStatusSeriesChunkKey(input: {
  intervalMinutes: number;
  generation: string;
  bucketStartIso: string;
  bucketEndIso: string;
}): string {
  assertPositiveInteger(input.intervalMinutes, "intervalMinutes");
  return [
    PUBLIC_STATUS_REDIS_PREFIX,
    "series",
    encodeKeyPart(input.generation),
    `${input.intervalMinutes}m`,
    encodeKeyPart(alignBucketStartUtc(input.bucketStartIso, input.intervalMinutes)),
    encodeKeyPart(alignBucketStartUtc(input.bucketEndIso, input.intervalMinutes)),
  ].join(":");
}

export function buildPublicStatusRebuildLockKey(flightKey: string): string {
  return `${PUBLIC_STATUS_REDIS_PREFIX}:rebuild-lock:${encodeKeyPart(flightKey)}`;
}

export function buildPublicStatusRebuildHintKey(input: {
  intervalMinutes: number;
  rangeHours: number;
}): string {
  assertPositiveInteger(input.intervalMinutes, "intervalMinutes");
  assertPositiveInteger(input.rangeHours, "rangeHours");
  return `${PUBLIC_STATUS_REDIS_PREFIX}:rebuild-hint:${input.intervalMinutes}m:${input.rangeHours}h`;
}

export function buildPublicStatusTempKey(baseKey: string, nonce: string): string {
  return `${baseKey}:tmp:${encodeKeyPart(nonce)}`;
}

// 核心公开语义：有完整代时优先服务历史快照，没有完整代时才诚实返回 rebuilding/no-data。
export function resolvePublicStatusManifestState(
  manifest: PublicStatusManifest | null,
  nowIso: string
): PublicStatusManifestResolution {
  if (!manifest) {
    return {
      rebuildState: "no-data",
      sourceGeneration: null,
      lastCompleteGeneration: null,
    };
  }

  if (!manifest.lastCompleteGeneration) {
    return {
      rebuildState: "rebuilding",
      sourceGeneration: null,
      lastCompleteGeneration: null,
    };
  }

  const nowMs = Date.parse(nowIso);
  const freshUntilMs = Date.parse(manifest.freshUntil);
  if (!Number.isNaN(nowMs) && !Number.isNaN(freshUntilMs) && nowMs <= freshUntilMs) {
    return {
      rebuildState: manifest.rebuildState === "rebuilding" ? "stale" : "fresh",
      sourceGeneration: manifest.lastCompleteGeneration,
      lastCompleteGeneration: manifest.lastCompleteGeneration,
    };
  }

  return {
    rebuildState: "stale",
    sourceGeneration: manifest.lastCompleteGeneration,
    lastCompleteGeneration: manifest.lastCompleteGeneration,
  };
}
