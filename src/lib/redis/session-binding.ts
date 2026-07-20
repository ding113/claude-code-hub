import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import { getRedisClient } from "./client";
import {
  CAS_SESSION_BINDING,
  CLEAR_SESSION_BINDING,
  DELETE_LEGACY_PROVIDER_IF_VALUE,
  READ_OR_RECONCILE_SESSION_BINDING,
  RESTORE_LEGACY_PROVIDER_IF_ABSENT,
  TERMINATE_SESSION_BINDING,
} from "./lua-scripts";

export const DEFAULT_SESSION_BINDING_TTL_SECONDS = 300;
const CAPABILITY_PROBE_TIMEOUT_MS = 5_000;

export type VersionedBindingCapabilityState = "unknown" | "available" | "unavailable";

export type SessionBindingConflictReason =
  | "canonical_corrupt"
  | "canonical_key_mismatch"
  | "canonical_missing"
  | "canonical_exists"
  | "foreign_legacy_owner"
  | "generation_mismatch"
  | "invalid_input"
  | "invalid_legacy_provider"
  | "mirror_conflict"
  | "mirror_missing"
  | "orphan_legacy_provider"
  | "provider_mismatch"
  | "unknown_conflict";

export type SessionBindingUnavailableReason =
  | "capability_probe_failed"
  | "capability_unavailable"
  | "connection_changed"
  | "operation_failed"
  | "redis_not_ready";

export interface SessionBindingSnapshot {
  sessionId: string;
  keyId: number;
  providerId: number | null;
  generation: string;
}

export interface SessionBindingKeys {
  canonical: string;
  legacyProvider: string;
  legacyOwner: string;
}

export interface SessionBindingRedisClient {
  readonly status: string;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  evalsha?(sha1: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  exists(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<number>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off?(event: string, listener: (...args: unknown[]) => void): unknown;
  set(
    key: string,
    value: string,
    expiryMode: "EX",
    ttlSeconds: number,
    condition: "NX"
  ): Promise<unknown>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
}

export interface ReadOrReconcileSessionBindingInput {
  sessionId: string;
  keyId: number;
  ttlSeconds?: number;
  redis?: SessionBindingRedisClient;
}

export interface CompareAndSetSessionBindingInput extends ReadOrReconcileSessionBindingInput {
  expectedGeneration: string;
  providerId: number;
}

export interface ClearSessionBindingInput extends ReadOrReconcileSessionBindingInput {
  expectedGeneration: string;
  expectedProviderId: number | null;
  cooldownTtlSeconds?: number;
}

export interface TerminateSessionBindingInput extends ReadOrReconcileSessionBindingInput {
  expectedProviderId?: number;
}

export type LegacySessionBindingMutation =
  | { type: "inspect" }
  | { type: "refresh" }
  | { type: "bind_if_absent"; providerId: number }
  | { type: "set"; providerId: number }
  | {
      type: "clear";
      expectedProviderId?: number | null;
      expectedProviderIds?: readonly number[];
    }
  | { type: "terminate"; expectedProviderIds?: readonly number[] };

export interface LegacySessionBindingMutationInput extends ReadOrReconcileSessionBindingInput {
  mutation: LegacySessionBindingMutation;
}

export type LegacySessionBindingMutationResult =
  | {
      status: "ok";
      changed: boolean;
      providerId: number | null;
    }
  | SessionBindingConflictResult
  | SessionBindingUnavailableResult;

export interface SessionProviderCooldownInput {
  sessionId: string;
  keyId: number;
  providerId: number;
  redis?: SessionBindingRedisClient;
}

export interface SessionBindingOkResult {
  status: "ok";
  snapshot: SessionBindingSnapshot;
  legacyFallbackAllowed: false;
  source: "created" | "existing" | "legacy_upgraded" | "updated" | "cleared" | "terminated";
}

export interface SessionBindingConflictResult {
  status: "conflict";
  reason: SessionBindingConflictReason;
  legacyFallbackAllowed: false;
}

export interface SessionBindingUnavailableResult {
  status: "unavailable";
  reason: SessionBindingUnavailableReason;
  capabilityState: VersionedBindingCapabilityState;
  legacyFallbackAllowed: boolean;
}

export type SessionBindingResult =
  | SessionBindingOkResult
  | SessionBindingConflictResult
  | SessionBindingUnavailableResult;
type SessionBindingFailureResult = SessionBindingConflictResult | SessionBindingUnavailableResult;

export type SessionProviderCooldownResult =
  | {
      status: "ok";
      coolingDown: boolean;
      legacyFallbackAllowed: false;
    }
  | SessionBindingConflictResult
  | SessionBindingUnavailableResult;

interface CapabilityListeners {
  close: (...args: unknown[]) => void;
  connect: (...args: unknown[]) => void;
  end: (...args: unknown[]) => void;
  ready: (...args: unknown[]) => void;
  reconnecting: (...args: unknown[]) => void;
}

interface ReadyClient {
  redis: SessionBindingRedisClient;
  epoch: number;
}

const READ_SOURCES = new Set(["created", "existing", "legacy_upgraded"]);
const MUTATION_SOURCES = new Set(["updated", "cleared"]);
const CONFLICT_REASONS = new Set<SessionBindingConflictReason>([
  "canonical_corrupt",
  "canonical_exists",
  "canonical_key_mismatch",
  "canonical_missing",
  "foreign_legacy_owner",
  "generation_mismatch",
  "invalid_input",
  "invalid_legacy_provider",
  "mirror_conflict",
  "mirror_missing",
  "orphan_legacy_provider",
  "provider_mismatch",
]);

let capabilityClient: SessionBindingRedisClient | null = null;
let capabilityState: VersionedBindingCapabilityState = "unknown";
let capabilityEpoch = 0;
let capabilityProbe: Promise<VersionedBindingCapabilityState> | null = null;
let capabilityListeners: CapabilityListeners | null = null;
const scriptSha1Cache = new Map<string, string>();

function namespacedKey(namespace: string | undefined, key: string): string {
  return namespace ? `${namespace}:${key}` : key;
}

function bindingHashTag(sessionId: string, keyId: number): string {
  return createHash("sha256").update(`${keyId}\0${sessionId}`).digest("hex");
}

export function buildCanonicalSessionBindingKey(
  sessionId: string,
  keyId: number,
  namespace?: string
): string {
  return namespacedKey(
    namespace,
    `session-binding:v1:{${bindingHashTag(sessionId, keyId)}}:binding`
  );
}

export function buildLegacySessionProviderKey(sessionId: string, namespace?: string): string {
  return namespacedKey(namespace, `session:${sessionId}:provider`);
}

export function buildLegacySessionOwnerKey(sessionId: string, namespace?: string): string {
  return namespacedKey(namespace, `session:${sessionId}:key`);
}

export function buildSessionProviderCooldownKey(
  sessionId: string,
  keyId: number,
  providerId: number,
  namespace?: string
): string {
  return namespacedKey(
    namespace,
    `session-binding:v1:{${bindingHashTag(sessionId, keyId)}}:provider:${providerId}:cooldown`
  );
}

export function buildSessionBindingKeys(
  sessionId: string,
  keyId: number,
  namespace?: string
): SessionBindingKeys {
  return {
    canonical: buildCanonicalSessionBindingKey(sessionId, keyId, namespace),
    legacyProvider: buildLegacySessionProviderKey(sessionId, namespace),
    legacyOwner: buildLegacySessionOwnerKey(sessionId, namespace),
  };
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidIdentity(sessionId: string, keyId: number, ttlSeconds: number): boolean {
  return sessionId.length > 0 && isPositiveInteger(keyId) && isPositiveInteger(ttlSeconds);
}

function conflict(reason: SessionBindingConflictReason): SessionBindingConflictResult {
  return { status: "conflict", reason, legacyFallbackAllowed: false };
}

function unavailable(reason: SessionBindingUnavailableReason): SessionBindingUnavailableResult {
  return {
    status: "unavailable",
    reason,
    capabilityState,
    legacyFallbackAllowed:
      reason === "capability_probe_failed" ||
      reason === "capability_unavailable" ||
      reason === "redis_not_ready",
  };
}

function normalizeEvalResult(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error("Invalid session binding Lua result");
  }
  return raw.map((value) => {
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
    if (Buffer.isBuffer(value)) {
      return value.toString("utf8");
    }
    throw new Error("Invalid value in session binding Lua result");
  });
}

function parseProviderId(raw: string): number | null {
  if (raw === "") return null;
  const providerId = Number(raw);
  if (!isPositiveInteger(providerId)) {
    throw new Error("Invalid provider id in session binding Lua result");
  }
  return providerId;
}

function parseBindingResult(
  raw: unknown,
  identity: { sessionId: string; keyId: number },
  allowedSources: Set<string>
): SessionBindingResult {
  const values = normalizeEvalResult(raw);
  if (values[0] === "conflict") {
    const reason = CONFLICT_REASONS.has(values[1] as SessionBindingConflictReason)
      ? (values[1] as SessionBindingConflictReason)
      : "unknown_conflict";
    return conflict(reason);
  }
  if (values[0] !== "ok" || values.length < 4 || !allowedSources.has(values[1])) {
    throw new Error("Unexpected session binding Lua result");
  }

  const generation = values[2];
  if (!generation) {
    throw new Error("Missing generation in session binding Lua result");
  }

  return {
    status: "ok",
    source: values[1] as SessionBindingOkResult["source"],
    snapshot: {
      ...identity,
      generation,
      providerId: parseProviderId(values[3]),
    },
    legacyFallbackAllowed: false,
  };
}

function detachCapabilityListeners(): void {
  if (!capabilityClient || !capabilityListeners || !capabilityClient.off) return;
  capabilityClient.off("close", capabilityListeners.close);
  capabilityClient.off("connect", capabilityListeners.connect);
  capabilityClient.off("end", capabilityListeners.end);
  capabilityClient.off("ready", capabilityListeners.ready);
  capabilityClient.off("reconnecting", capabilityListeners.reconnecting);
}

function resetCapabilityForConnection(client: SessionBindingRedisClient): void {
  if (capabilityClient !== client) return;
  capabilityEpoch += 1;
  capabilityState = "unknown";
  capabilityProbe = null;
}

function attachCapabilityClient(client: SessionBindingRedisClient): void {
  if (capabilityClient === client) return;

  detachCapabilityListeners();
  capabilityClient = client;
  capabilityEpoch += 1;
  capabilityState = "unknown";
  capabilityProbe = null;

  const listeners: CapabilityListeners = {
    close: () => resetCapabilityForConnection(client),
    connect: () => resetCapabilityForConnection(client),
    end: () => resetCapabilityForConnection(client),
    ready: () => {
      resetCapabilityForConnection(client);
      void ensureVersionedBindingCapability(client);
    },
    reconnecting: () => resetCapabilityForConnection(client),
  };
  capabilityListeners = listeners;
  client.on("close", listeners.close);
  client.on("connect", listeners.connect);
  client.on("end", listeners.end);
  client.on("ready", listeners.ready);
  client.on("reconnecting", listeners.reconnecting);
}

function currentRedisClient(
  override?: SessionBindingRedisClient
): SessionBindingRedisClient | null {
  if (override) return override;
  return getRedisClient({ allowWhenRateLimitDisabled: true }) as SessionBindingRedisClient | null;
}

function scriptSha1(script: string): string {
  const cached = scriptSha1Cache.get(script);
  if (cached) return cached;
  const digest = createHash("sha1").update(script).digest("hex");
  scriptSha1Cache.set(script, digest);
  return digest;
}

async function evalBindingScript(
  redis: SessionBindingRedisClient,
  script: string,
  numberOfKeys: number,
  ...args: Array<string | number>
): Promise<unknown> {
  if (!redis.evalsha) return redis.eval(script, numberOfKeys, ...args);
  try {
    return await redis.evalsha(scriptSha1(script), numberOfKeys, ...args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/NOSCRIPT/i.test(message)) throw error;
    return redis.eval(script, numberOfKeys, ...args);
  }
}

function markCapabilityUnavailable(
  client: SessionBindingRedisClient,
  epoch: number,
  error: unknown
): void {
  if (capabilityClient !== client || capabilityEpoch !== epoch) return;
  capabilityState = "unavailable";
  capabilityProbe = null;
  logger.warn("Versioned session binding Redis capability is unavailable", {
    error: error instanceof Error ? error.message : String(error),
  });
}

function isCapabilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /CROSSSLOT|NOPERM|unknown command|EVAL.*(?:disabled|not allowed)|script execution disabled|Lua scripts? (?:are )?disabled/i.test(
    message
  );
}

function isBindingDataError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.startsWith("Invalid session binding Lua result") ||
    message.startsWith("Invalid value in session binding Lua result") ||
    message.startsWith("Unexpected session binding Lua result") ||
    message.startsWith("Missing generation in session binding Lua result") ||
    message.startsWith("Invalid provider id in session binding Lua result") ||
    message.includes("WRONGTYPE")
  );
}

function handleOperationError(ready: ReadyClient, error: unknown): SessionBindingFailureResult {
  if (isCapabilityError(error)) {
    markCapabilityUnavailable(ready.redis, ready.epoch, error);
    return unavailable("capability_unavailable");
  }

  if (isBindingDataError(error)) {
    logger.warn("Versioned session binding data is invalid", {
      error: error instanceof Error ? error.message : String(error),
    });
    return conflict("canonical_corrupt");
  }

  logger.warn("Versioned session binding operation failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  return unavailable("operation_failed");
}

async function runCapabilityProbe(
  client: SessionBindingRedisClient,
  epoch: number
): Promise<boolean> {
  const deadlineAt = Date.now() + CAPABILITY_PROBE_TIMEOUT_MS;
  const namespace = `session-binding-capability-probe:${randomUUID()}`;
  const sessionId = "probe-session";
  const keyId = 1;
  const providerId = 1;
  const ttlSeconds = 60;
  const keys = buildSessionBindingKeys(sessionId, keyId, namespace);
  const cooldownKey = buildSessionProviderCooldownKey(sessionId, keyId, providerId, namespace);
  const cleanupKeys = [keys.canonical, keys.legacyProvider, keys.legacyOwner, cooldownKey];
  const initialGeneration = randomUUID();
  const boundGeneration = randomUUID();
  const clearedGeneration = randomUUID();
  let operationsSucceeded = false;
  let cleanupSucceeded = false;

  try {
    const read = parseBindingResult(
      await withCapabilityProbeDeadline(
        client.eval(
          READ_OR_RECONCILE_SESSION_BINDING,
          3,
          keys.canonical,
          keys.legacyProvider,
          keys.legacyOwner,
          keyId.toString(),
          initialGeneration,
          ttlSeconds.toString()
        ),
        deadlineAt
      ),
      { sessionId, keyId },
      READ_SOURCES
    );
    if (read.status !== "ok" || read.source !== "created") {
      throw new Error("Session binding capability probe reconcile failed");
    }

    const updated = parseBindingResult(
      await withCapabilityProbeDeadline(
        client.eval(
          CAS_SESSION_BINDING,
          3,
          keys.canonical,
          keys.legacyProvider,
          keys.legacyOwner,
          keyId.toString(),
          read.snapshot.generation,
          boundGeneration,
          providerId.toString(),
          ttlSeconds.toString()
        ),
        deadlineAt
      ),
      { sessionId, keyId },
      MUTATION_SOURCES
    );
    if (updated.status !== "ok" || updated.source !== "updated") {
      throw new Error("Session binding capability probe update failed");
    }

    const cleared = parseBindingResult(
      await withCapabilityProbeDeadline(
        client.eval(
          CLEAR_SESSION_BINDING,
          4,
          keys.canonical,
          keys.legacyProvider,
          keys.legacyOwner,
          cooldownKey,
          keyId.toString(),
          updated.snapshot.generation,
          clearedGeneration,
          providerId.toString(),
          ttlSeconds.toString(),
          providerId.toString(),
          ttlSeconds.toString()
        ),
        deadlineAt
      ),
      { sessionId, keyId },
      MUTATION_SOURCES
    );
    if (cleared.status !== "ok" || cleared.source !== "cleared") {
      throw new Error("Session binding capability probe clear failed");
    }

    const cooldownGeneration = await withCapabilityProbeDeadline(
      client.get(cooldownKey),
      deadlineAt
    );
    if (cooldownGeneration !== cleared.snapshot.generation) {
      throw new Error("Session binding capability probe cooldown failed");
    }
    operationsSucceeded = capabilityClient === client && capabilityEpoch === epoch;
  } catch (error) {
    logger.warn("Versioned session binding Redis capability probe failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    try {
      await withCapabilityProbeDeadline(
        Promise.all(cleanupKeys.map((key) => client.del(key))),
        deadlineAt
      );
      cleanupSucceeded = true;
    } catch (error) {
      logger.warn("Versioned session binding Redis capability probe cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return operationsSucceeded && cleanupSucceeded;
}

async function withCapabilityProbeDeadline<T>(
  operation: Promise<T>,
  deadlineAt: number
): Promise<T> {
  // The timeout races the Redis command but cannot cancel it. Observe a late
  // rejection so an operation that settles after the deadline never becomes
  // an unhandled promise rejection.
  operation.catch(() => {});
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw new Error("Session binding capability probe deadline exceeded");

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Session binding capability probe deadline exceeded")),
      remainingMs
    );
    timeout.unref?.();
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function getVersionedBindingCapabilityState(): VersionedBindingCapabilityState {
  return capabilityState;
}

export async function ensureVersionedBindingCapability(
  redisOverride?: SessionBindingRedisClient
): Promise<VersionedBindingCapabilityState> {
  const redis = currentRedisClient(redisOverride);
  if (!redis) return "unknown";

  attachCapabilityClient(redis);
  if (redis.status !== "ready") return capabilityState;
  if (capabilityState !== "unknown") return capabilityState;
  if (capabilityProbe) return capabilityProbe;

  const epoch = capabilityEpoch;
  const probe = (async () => {
    const supported = await runCapabilityProbe(redis, epoch);
    if (capabilityClient !== redis || capabilityEpoch !== epoch) {
      return capabilityState;
    }
    capabilityState = supported ? "available" : "unavailable";
    return capabilityState;
  })();
  capabilityProbe = probe;

  try {
    return await probe;
  } finally {
    if (capabilityProbe === probe) capabilityProbe = null;
  }
}

async function readyVersionedClient(
  redisOverride?: SessionBindingRedisClient
): Promise<ReadyClient | SessionBindingUnavailableResult> {
  const redis = currentRedisClient(redisOverride);
  if (!redis) return unavailable("redis_not_ready");

  attachCapabilityClient(redis);
  if (redis.status !== "ready") return unavailable("redis_not_ready");

  const state = await ensureVersionedBindingCapability(redis);
  if (state !== "available") {
    return unavailable(
      state === "unavailable" ? "capability_unavailable" : "capability_probe_failed"
    );
  }
  return { redis, epoch: capabilityEpoch };
}

function connectionIsCurrent(ready: ReadyClient): boolean {
  return capabilityClient === ready.redis && capabilityEpoch === ready.epoch;
}

export async function readOrReconcileSessionBinding(
  input: ReadOrReconcileSessionBindingInput
): Promise<SessionBindingResult> {
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_SESSION_BINDING_TTL_SECONDS;
  if (!isValidIdentity(input.sessionId, input.keyId, ttlSeconds)) {
    return conflict("invalid_input");
  }

  const ready = await readyVersionedClient(input.redis);
  if ("status" in ready) return ready;

  const keys = buildSessionBindingKeys(input.sessionId, input.keyId);
  try {
    const raw = await evalBindingScript(
      ready.redis,
      READ_OR_RECONCILE_SESSION_BINDING,
      3,
      keys.canonical,
      keys.legacyProvider,
      keys.legacyOwner,
      input.keyId.toString(),
      randomUUID(),
      ttlSeconds.toString()
    );
    if (!connectionIsCurrent(ready)) return unavailable("connection_changed");
    return parseBindingResult(
      raw,
      { sessionId: input.sessionId, keyId: input.keyId },
      READ_SOURCES
    );
  } catch (error) {
    return handleOperationError(ready, error);
  }
}

export async function refreshSessionBinding(
  input: ReadOrReconcileSessionBindingInput
): Promise<SessionBindingResult> {
  return readOrReconcileSessionBinding(input);
}

export async function compareAndSetSessionBinding(
  input: CompareAndSetSessionBindingInput
): Promise<SessionBindingResult> {
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_SESSION_BINDING_TTL_SECONDS;
  if (
    !isValidIdentity(input.sessionId, input.keyId, ttlSeconds) ||
    !input.expectedGeneration ||
    !isPositiveInteger(input.providerId)
  ) {
    return conflict("invalid_input");
  }

  const ready = await readyVersionedClient(input.redis);
  if ("status" in ready) return ready;

  const keys = buildSessionBindingKeys(input.sessionId, input.keyId);
  try {
    const raw = await evalBindingScript(
      ready.redis,
      CAS_SESSION_BINDING,
      3,
      keys.canonical,
      keys.legacyProvider,
      keys.legacyOwner,
      input.keyId.toString(),
      input.expectedGeneration,
      randomUUID(),
      input.providerId.toString(),
      ttlSeconds.toString()
    );
    if (!connectionIsCurrent(ready)) return unavailable("connection_changed");
    return parseBindingResult(
      raw,
      { sessionId: input.sessionId, keyId: input.keyId },
      MUTATION_SOURCES
    );
  } catch (error) {
    return handleOperationError(ready, error);
  }
}

export async function clearSessionBinding(
  input: ClearSessionBindingInput
): Promise<SessionBindingResult> {
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_SESSION_BINDING_TTL_SECONDS;
  const cooldownTtlSeconds = input.cooldownTtlSeconds ?? 0;
  if (
    !isValidIdentity(input.sessionId, input.keyId, ttlSeconds) ||
    !input.expectedGeneration ||
    (input.expectedProviderId !== null && !isPositiveInteger(input.expectedProviderId)) ||
    !Number.isSafeInteger(cooldownTtlSeconds) ||
    cooldownTtlSeconds < 0 ||
    (cooldownTtlSeconds > 0 && input.expectedProviderId === null)
  ) {
    return conflict("invalid_input");
  }

  const ready = await readyVersionedClient(input.redis);
  if ("status" in ready) return ready;

  const keys = buildSessionBindingKeys(input.sessionId, input.keyId);
  const cooldownKey =
    input.expectedProviderId === null
      ? keys.canonical
      : buildSessionProviderCooldownKey(input.sessionId, input.keyId, input.expectedProviderId);
  const expectedProviderId = input.expectedProviderId?.toString() ?? "";

  try {
    const raw = await evalBindingScript(
      ready.redis,
      CLEAR_SESSION_BINDING,
      4,
      keys.canonical,
      keys.legacyProvider,
      keys.legacyOwner,
      cooldownKey,
      input.keyId.toString(),
      input.expectedGeneration,
      randomUUID(),
      expectedProviderId,
      ttlSeconds.toString(),
      cooldownTtlSeconds > 0 ? expectedProviderId : "",
      cooldownTtlSeconds.toString()
    );
    if (!connectionIsCurrent(ready)) return unavailable("connection_changed");
    return parseBindingResult(
      raw,
      { sessionId: input.sessionId, keyId: input.keyId },
      MUTATION_SOURCES
    );
  } catch (error) {
    return handleOperationError(ready, error);
  }
}

export async function terminateSessionBinding(
  input: TerminateSessionBindingInput
): Promise<SessionBindingResult> {
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_SESSION_BINDING_TTL_SECONDS;
  if (
    !isValidIdentity(input.sessionId, input.keyId, ttlSeconds) ||
    (input.expectedProviderId !== undefined && !isPositiveInteger(input.expectedProviderId))
  ) {
    return conflict("invalid_input");
  }

  const ready = await readyVersionedClient(input.redis);
  if ("status" in ready) return ready;

  const keys = buildSessionBindingKeys(input.sessionId, input.keyId);
  try {
    const raw = await evalBindingScript(
      ready.redis,
      TERMINATE_SESSION_BINDING,
      3,
      keys.canonical,
      keys.legacyProvider,
      keys.legacyOwner,
      input.keyId.toString(),
      randomUUID(),
      ttlSeconds.toString(),
      input.expectedProviderId?.toString() ?? ""
    );
    if (!connectionIsCurrent(ready)) return unavailable("connection_changed");
    return parseBindingResult(
      raw,
      { sessionId: input.sessionId, keyId: input.keyId },
      new Set(["terminated"])
    );
  } catch (error) {
    return handleOperationError(ready, error);
  }
}

function parseLegacyProviderId(raw: string | null): number | null | undefined {
  if (raw === null) return null;
  const providerId = Number(raw);
  return isPositiveInteger(providerId) ? providerId : undefined;
}

/**
 * A legacy fallback mutation can race a different worker which has already
 * recovered versioned binding capability. Re-check the canonical key after a
 * legacy write and fail closed if the versioned owner appeared in between.
 * Rollback uses a single-key conditional Lua script, so a concurrent versioned
 * writer cannot have its newer provider value deleted. If scripts are disabled
 * entirely, the mutation still fails closed and leaves the mirror untouched.
 */
async function rejectLegacyMutationAfterCanonicalAppeared(
  redis: SessionBindingRedisClient,
  keys: SessionBindingKeys,
  rollbackProviderValue?: string,
  restoreProviderValue?: { value: string; ttlSeconds: number }
): Promise<SessionBindingConflictResult | null> {
  if ((await redis.exists(keys.canonical)) === 0) return null;

  if (rollbackProviderValue !== undefined) {
    try {
      await redis.eval(
        DELETE_LEGACY_PROVIDER_IF_VALUE,
        1,
        keys.legacyProvider,
        rollbackProviderValue
      );
    } catch (error) {
      logger.warn("Legacy binding rollback could not execute atomically", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (restoreProviderValue !== undefined) {
    try {
      await redis.eval(
        RESTORE_LEGACY_PROVIDER_IF_ABSENT,
        1,
        keys.legacyProvider,
        restoreProviderValue.value,
        restoreProviderValue.ttlSeconds.toString()
      );
    } catch (error) {
      logger.warn("Legacy binding mirror restoration could not execute atomically", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return conflict("canonical_exists");
}

export async function mutateLegacySessionBindingSafely(
  input: LegacySessionBindingMutationInput
): Promise<LegacySessionBindingMutationResult> {
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_SESSION_BINDING_TTL_SECONDS;
  if (!isValidIdentity(input.sessionId, input.keyId, ttlSeconds)) {
    return conflict("invalid_input");
  }

  const providerFromMutation =
    input.mutation.type === "bind_if_absent" || input.mutation.type === "set"
      ? input.mutation.providerId
      : null;
  if (providerFromMutation !== null && !isPositiveInteger(providerFromMutation)) {
    return conflict("invalid_input");
  }
  if (
    input.mutation.type === "terminate" &&
    input.mutation.expectedProviderIds?.some((providerId) => !isPositiveInteger(providerId))
  ) {
    return conflict("invalid_input");
  }
  if (
    input.mutation.type === "clear" &&
    ((input.mutation.expectedProviderId != null &&
      !isPositiveInteger(input.mutation.expectedProviderId)) ||
      input.mutation.expectedProviderIds?.some((providerId) => !isPositiveInteger(providerId)) ||
      (input.mutation.expectedProviderId != null &&
        input.mutation.expectedProviderIds !== undefined))
  ) {
    return conflict("invalid_input");
  }

  const redis = currentRedisClient(input.redis);
  if (!redis || redis.status !== "ready") return unavailable("redis_not_ready");

  const keys = buildSessionBindingKeys(input.sessionId, input.keyId);
  try {
    if ((await redis.exists(keys.canonical)) > 0) {
      return conflict("canonical_exists");
    }

    let [legacyOwner, legacyProviderRaw] = await Promise.all([
      redis.get(keys.legacyOwner),
      redis.get(keys.legacyProvider),
    ]);
    if (legacyOwner === null) {
      if (legacyProviderRaw !== null) return conflict("orphan_legacy_provider");
      await redis.set(keys.legacyOwner, input.keyId.toString(), "EX", ttlSeconds, "NX");
      [legacyOwner, legacyProviderRaw] = await Promise.all([
        redis.get(keys.legacyOwner),
        redis.get(keys.legacyProvider),
      ]);
    }

    if (legacyOwner !== input.keyId.toString()) return conflict("foreign_legacy_owner");
    const legacyProvider = parseLegacyProviderId(legacyProviderRaw);
    if (legacyProvider === undefined) return conflict("invalid_legacy_provider");
    if ((await redis.exists(keys.canonical)) > 0) return conflict("canonical_exists");

    switch (input.mutation.type) {
      case "inspect":
        return { status: "ok", changed: false, providerId: legacyProvider };
      case "refresh":
        await redis.expire(keys.legacyOwner, ttlSeconds);
        if (legacyProvider !== null) await redis.expire(keys.legacyProvider, ttlSeconds);
        {
          const conflictAfterRefresh = await rejectLegacyMutationAfterCanonicalAppeared(
            redis,
            keys
          );
          if (conflictAfterRefresh) return conflictAfterRefresh;
        }
        return { status: "ok", changed: false, providerId: legacyProvider };
      case "bind_if_absent": {
        if (legacyProvider !== null) {
          return { status: "ok", changed: false, providerId: legacyProvider };
        }
        const result = await redis.set(
          keys.legacyProvider,
          input.mutation.providerId.toString(),
          "EX",
          ttlSeconds,
          "NX"
        );
        await redis.expire(keys.legacyOwner, ttlSeconds);
        if (result === "OK") {
          const conflictAfterBind = await rejectLegacyMutationAfterCanonicalAppeared(
            redis,
            keys,
            input.mutation.providerId.toString()
          );
          if (conflictAfterBind) return conflictAfterBind;
          return { status: "ok", changed: true, providerId: input.mutation.providerId };
        }
        const concurrentProvider = parseLegacyProviderId(await redis.get(keys.legacyProvider));
        if (concurrentProvider === undefined) return conflict("invalid_legacy_provider");
        return { status: "ok", changed: false, providerId: concurrentProvider };
      }
      case "set":
        await redis.setex(keys.legacyProvider, ttlSeconds, input.mutation.providerId.toString());
        await redis.expire(keys.legacyOwner, ttlSeconds);
        {
          const conflictAfterSet = await rejectLegacyMutationAfterCanonicalAppeared(
            redis,
            keys,
            input.mutation.providerId.toString()
          );
          if (conflictAfterSet) return conflictAfterSet;
        }
        return { status: "ok", changed: true, providerId: input.mutation.providerId };
      case "clear":
        if (
          (input.mutation.expectedProviderId != null &&
            legacyProvider !== input.mutation.expectedProviderId) ||
          (input.mutation.expectedProviderIds &&
            (legacyProvider === null ||
              !input.mutation.expectedProviderIds.includes(legacyProvider)))
        ) {
          return conflict("provider_mismatch");
        }
        if (legacyProvider === null) {
          return { status: "ok", changed: false, providerId: null };
        }
        await redis.del(keys.legacyProvider);
        await redis.expire(keys.legacyOwner, ttlSeconds);
        {
          const conflictAfterClear = await rejectLegacyMutationAfterCanonicalAppeared(
            redis,
            keys,
            undefined,
            { value: legacyProvider.toString(), ttlSeconds }
          );
          if (conflictAfterClear) return conflictAfterClear;
        }
        return { status: "ok", changed: true, providerId: null };
      case "terminate":
        if (
          input.mutation.expectedProviderIds &&
          (legacyProvider === null || !input.mutation.expectedProviderIds.includes(legacyProvider))
        ) {
          return conflict("provider_mismatch");
        }
        if (legacyProvider !== null) await redis.del(keys.legacyProvider);
        await redis.del(keys.legacyOwner);
        {
          const conflictAfterTerminate = await rejectLegacyMutationAfterCanonicalAppeared(
            redis,
            keys
          );
          if (conflictAfterTerminate) return conflictAfterTerminate;
        }
        return { status: "ok", changed: legacyProvider !== null, providerId: null };
    }
  } catch (error) {
    logger.warn("Legacy session binding mutation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return unavailable("operation_failed");
  }
}

export async function isSessionProviderCoolingDown(
  input: SessionProviderCooldownInput
): Promise<SessionProviderCooldownResult> {
  if (
    input.sessionId.length === 0 ||
    !isPositiveInteger(input.keyId) ||
    !isPositiveInteger(input.providerId)
  ) {
    return conflict("invalid_input");
  }

  const ready = await readyVersionedClient(input.redis);
  if ("status" in ready) return ready;

  try {
    const value = await ready.redis.get(
      buildSessionProviderCooldownKey(input.sessionId, input.keyId, input.providerId)
    );
    if (!connectionIsCurrent(ready)) return unavailable("connection_changed");
    return { status: "ok", coolingDown: value !== null, legacyFallbackAllowed: false };
  } catch (error) {
    return handleOperationError(ready, error);
  }
}

export function resetVersionedBindingCapabilityForTests(): void {
  detachCapabilityListeners();
  capabilityClient = null;
  capabilityState = "unknown";
  capabilityEpoch = 0;
  capabilityProbe = null;
  capabilityListeners = null;
}
