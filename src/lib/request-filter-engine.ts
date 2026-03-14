import safeRegex from "safe-regex";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { logger } from "@/lib/logger";
import type {
  FilterMatcher,
  FilterOperation,
  InsertOp,
  MergeOp,
  RemoveOp,
  SetOp,
} from "@/lib/request-filter-types";
import type {
  RequestFilter,
  RequestFilterAction,
  RequestFilterMatchType,
} from "@/repository/request-filters";

// Internal interface with performance optimizations
interface CachedRequestFilter extends RequestFilter {
  compiledRegex?: RegExp; // Pre-compiled regex for text_replace
  providerIdsSet?: Set<number>; // O(1) provider lookup
  groupTagsSet?: Set<string>; // O(1) group lookup
}

// Transport headers that must never be user-controlled
const TRANSPORT_HEADER_BLACKLIST = ["content-length", "connection", "transfer-encoding"];

// Keys that must never be traversed to prevent prototype pollution
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// ---------------------------------------------------------------------------
// Path helpers (shared by guard and final phases)
// ---------------------------------------------------------------------------

function parsePath(path: string): Array<string | number> {
  const parts: Array<string | number> = [];
  const regex = /([^.[\]]+)|(\[(\d+)\])/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(path)) !== null) {
    if (match[1]) {
      if (UNSAFE_KEYS.has(match[1])) return []; // reject entire path on unsafe key
      parts.push(match[1]);
    } else if (match[3]) {
      parts.push(Number(match[3]));
    }
  }
  return parts;
}

function setValueByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  if (!path || typeof path !== "string" || path.trim().length === 0) {
    logger.warn("[RequestFilterEngine] Invalid path in setValueByPath", { path });
    return;
  }

  const keys = parsePath(path);
  if (keys.length === 0) {
    logger.warn("[RequestFilterEngine] Empty keys after parsing path", { path });
    return;
  }

  let current: Record<string | number, unknown> = obj;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const isLast = i === keys.length - 1;

    if (isLast) {
      current[key] = value;
      return;
    }

    if (current[key] === undefined) {
      const nextKey = keys[i + 1];
      current[key] = typeof nextKey === "number" ? [] : {};
    }

    const next = current[key];
    if (next === null || typeof next !== "object") {
      const nextKey = keys[i + 1];
      current[key] = typeof nextKey === "number" ? [] : {};
    }
    current = current[key] as Record<string | number, unknown>;
  }
}

/** Read-only traversal, returns undefined if path not found */
function getValueByPath(obj: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  const keys = parsePath(path);
  if (keys.length === 0) return undefined;
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

/** Navigate to parent, delete last key */
function deleteByPath(obj: Record<string, unknown>, path: string): void {
  const keys = parsePath(path);
  if (keys.length === 0) return;

  let current: unknown = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current === null || current === undefined || typeof current !== "object") return;
    current = (current as Record<string | number, unknown>)[keys[i]];
  }

  if (current === null || current === undefined || typeof current !== "object") return;

  const lastKey = keys[keys.length - 1];
  if (Array.isArray(current) && typeof lastKey === "number") {
    current.splice(lastKey, 1);
  } else {
    delete (current as Record<string | number, unknown>)[lastKey];
  }
}

// ---------------------------------------------------------------------------
// Deep helpers
// ---------------------------------------------------------------------------

/** Recursive structural equality check */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.hasOwn(bObj, key)) return false;
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }

  return false;
}

/** Recursive merge with null-as-delete semantics */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (UNSAFE_KEYS.has(key)) continue; // block prototype pollution
    if (value === null) {
      delete target[key];
    } else if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof target[key] === "object" &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
}

/** Check if element matches a FilterMatcher */
function matchElement(element: unknown, matcher: FilterMatcher): boolean {
  let fieldValue: unknown;
  if (matcher.field) {
    if (element === null || element === undefined || typeof element !== "object") return false;
    // Support dot-path extraction
    const parts = matcher.field.split(".");
    let cur: unknown = element;
    for (const part of parts) {
      if (cur === null || cur === undefined || typeof cur !== "object") return false;
      cur = (cur as Record<string, unknown>)[part];
    }
    fieldValue = cur;
  } else {
    fieldValue = element;
  }

  const matchType = matcher.matchType ?? "exact";
  switch (matchType) {
    case "exact":
      if (typeof fieldValue === "object" || typeof matcher.value === "object") {
        return deepEqual(fieldValue, matcher.value);
      }
      return fieldValue === matcher.value;
    case "contains":
      return String(fieldValue).includes(String(matcher.value));
    case "regex": {
      const pattern = String(matcher.value);
      if (!safeRegex(pattern)) {
        logger.warn("[RequestFilterEngine] Unsafe regex in matcher", { pattern });
        return false;
      }
      try {
        return new RegExp(pattern).test(String(fieldValue));
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Text replace helpers (unchanged from original)
// ---------------------------------------------------------------------------

function replaceText(
  input: string,
  target: string,
  replacement: string,
  matchType: RequestFilterMatchType,
  compiledRegex?: RegExp
): string {
  switch (matchType) {
    case "regex": {
      if (compiledRegex) {
        try {
          const re = new RegExp(compiledRegex.source, compiledRegex.flags);
          return input.replace(re, replacement);
        } catch (error) {
          logger.error("[RequestFilterEngine] Regex replace failed", { error });
          return input;
        }
      }

      if (!safeRegex(target)) {
        logger.warn("[RequestFilterEngine] Skip unsafe regex", { target });
        return input;
      }
      try {
        const re = new RegExp(target, "g");
        return input.replace(re, replacement);
      } catch (error) {
        logger.error("[RequestFilterEngine] Invalid regex pattern", { target, error });
        return input;
      }
    }
    case "exact":
      return input === target ? replacement : input;
    default: {
      if (!target) return input;
      return input.split(target).join(replacement);
    }
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class RequestFilterEngine {
  // Guard-phase buckets (existing behavior)
  private globalGuardFilters: CachedRequestFilter[] = [];
  private providerGuardFilters: CachedRequestFilter[] = [];

  // Final-phase buckets (new)
  private globalFinalFilters: CachedRequestFilter[] = [];
  private providerFinalFilters: CachedRequestFilter[] = [];

  private lastReloadTime = 0;
  private isLoading = false;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  private eventEmitterCleanup: (() => void) | null = null;
  private redisPubSubCleanup: (() => void) | null = null;

  private hasGroupBasedFilters = false;
  private hasGroupBasedFinalFilters = false;

  // Backward-compat accessors used by existing code paths
  private get globalFilters(): CachedRequestFilter[] {
    return this.globalGuardFilters;
  }
  private set globalFilters(v: CachedRequestFilter[]) {
    this.globalGuardFilters = v;
  }
  private get providerFilters(): CachedRequestFilter[] {
    return this.providerGuardFilters;
  }
  private set providerFilters(v: CachedRequestFilter[]) {
    this.providerGuardFilters = v;
  }

  constructor() {
    this.setupEventListener();
  }

  private async setupEventListener(): Promise<void> {
    if (typeof process !== "undefined" && process.env.NEXT_RUNTIME !== "edge") {
      try {
        const { eventEmitter } = await import("@/lib/event-emitter");
        const handler = () => {
          logger.info("[RequestFilterEngine] Received requestFiltersUpdated event, reloading...");
          void this.reload();
        };
        eventEmitter.on("requestFiltersUpdated", handler);
        logger.info("[RequestFilterEngine] Subscribed to local eventEmitter");

        this.eventEmitterCleanup = () => {
          eventEmitter.off("requestFiltersUpdated", handler);
        };

        try {
          const { CHANNEL_REQUEST_FILTERS_UPDATED, subscribeCacheInvalidation } = await import(
            "@/lib/redis/pubsub"
          );
          const cleanup = await subscribeCacheInvalidation(
            CHANNEL_REQUEST_FILTERS_UPDATED,
            handler
          );
          if (cleanup) {
            this.redisPubSubCleanup = cleanup;
            logger.info("[RequestFilterEngine] Subscribed to Redis pub/sub channel");
          }
        } catch (error) {
          logger.warn("[RequestFilterEngine] Failed to subscribe to Redis pub/sub", { error });
        }
      } catch (error) {
        logger.warn("[RequestFilterEngine] Failed to setup event listener", { error });
      }
    }
  }

  destroy(): void {
    if (this.eventEmitterCleanup) {
      this.eventEmitterCleanup();
      this.eventEmitterCleanup = null;
    }
    if (this.redisPubSubCleanup) {
      this.redisPubSubCleanup();
      this.redisPubSubCleanup = null;
    }
  }

  async reload(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const { getActiveRequestFilters } = await import("@/repository/request-filters");
      const filters = await getActiveRequestFilters();
      this.loadFilters(filters);
    } catch (error) {
      logger.error("[RequestFilterEngine] Failed to reload filters", { error });
    } finally {
      this.isLoading = false;
    }
  }

  /** Shared filter loading logic (used by reload and setFiltersForTest) */
  private loadFilters(filters: RequestFilter[]): void {
    const cachedFilters = filters.map((f) => {
      const cached: CachedRequestFilter = { ...f };

      if (f.matchType === "regex" && f.action === "text_replace") {
        if (!safeRegex(f.target)) {
          logger.warn("[RequestFilterEngine] Skip unsafe regex at load", {
            filterId: f.id,
            target: f.target,
          });
        } else {
          try {
            cached.compiledRegex = new RegExp(f.target, "g");
          } catch (error) {
            logger.warn("[RequestFilterEngine] Failed to compile regex at load", {
              filterId: f.id,
              target: f.target,
              error,
            });
          }
        }
      }

      if (f.bindingType === "providers" && f.providerIds) {
        cached.providerIdsSet = new Set(f.providerIds);
      }
      if (f.bindingType === "groups" && f.groupTags) {
        cached.groupTagsSet = new Set(f.groupTags);
      }

      return cached;
    });

    const isGlobal = (f: CachedRequestFilter) => f.bindingType === "global" || !f.bindingType;
    const isProvider = (f: CachedRequestFilter) =>
      f.bindingType === "providers" || f.bindingType === "groups";
    const isGuard = (f: CachedRequestFilter) => (f.executionPhase ?? "guard") === "guard";
    const isFinal = (f: CachedRequestFilter) => f.executionPhase === "final";
    const byPriority = (a: CachedRequestFilter, b: CachedRequestFilter) =>
      a.priority - b.priority || a.id - b.id;

    this.globalGuardFilters = cachedFilters
      .filter((f) => isGlobal(f) && isGuard(f))
      .sort(byPriority);
    this.providerGuardFilters = cachedFilters
      .filter((f) => isProvider(f) && isGuard(f))
      .sort(byPriority);
    this.globalFinalFilters = cachedFilters
      .filter((f) => isGlobal(f) && isFinal(f))
      .sort(byPriority);
    this.providerFinalFilters = cachedFilters
      .filter((f) => isProvider(f) && isFinal(f))
      .sort(byPriority);

    this.hasGroupBasedFilters = this.providerGuardFilters.some((f) => f.bindingType === "groups");
    this.hasGroupBasedFinalFilters = this.providerFinalFilters.some(
      (f) => f.bindingType === "groups"
    );

    this.lastReloadTime = Date.now();
    this.isInitialized = true;
    logger.info("[RequestFilterEngine] Filters reloaded", {
      globalGuard: this.globalGuardFilters.length,
      providerGuard: this.providerGuardFilters.length,
      globalFinal: this.globalFinalFilters.length,
      providerFinal: this.providerFinalFilters.length,
      timestamp: new Date().toISOString(),
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;
    if (!this.initializationPromise) {
      this.initializationPromise = this.reload().finally(() => {
        this.initializationPromise = null;
      });
    }
    await this.initializationPromise;
  }

  // ---------------------------------------------------------------------------
  // Guard phase (existing behavior, unchanged API)
  // ---------------------------------------------------------------------------

  async applyGlobal(session: ProxySession): Promise<void> {
    if (this.isInitialized && this.globalGuardFilters.length === 0) return;

    await this.ensureInitialized();
    if (this.globalGuardFilters.length === 0) return;

    for (const filter of this.globalGuardFilters) {
      try {
        if (filter.scope === "header") {
          this.applyHeaderFilter(session, filter);
        } else if (filter.scope === "body") {
          this.applyBodyFilter(session, filter);
        }
      } catch (error) {
        logger.error("[RequestFilterEngine] Failed to apply global filter", {
          filterId: filter.id,
          scope: filter.scope,
          action: filter.action,
          error,
        });
      }
    }
  }

  async applyForProvider(session: ProxySession): Promise<void> {
    if (this.isInitialized && this.providerGuardFilters.length === 0) return;

    await this.ensureInitialized();
    if (this.providerGuardFilters.length === 0 || !session.provider) return;

    const providerId = session.provider.id;

    let providerTagsSet: Set<string> | null = null;
    if (this.hasGroupBasedFilters) {
      const providerGroupTag = session.provider.groupTag;
      providerTagsSet = new Set(providerGroupTag?.split(",").map((t) => t.trim()) ?? []);
    }

    for (const filter of this.providerGuardFilters) {
      let matches = false;

      if (filter.bindingType === "providers") {
        matches = filter.providerIdsSet?.has(providerId) ?? false;
      } else if (filter.bindingType === "groups" && providerTagsSet) {
        matches = filter.groupTagsSet
          ? Array.from(providerTagsSet).some((tag) => filter.groupTagsSet!.has(tag))
          : false;
      }

      if (!matches) continue;

      try {
        if (filter.scope === "header") {
          this.applyHeaderFilter(session, filter);
        } else if (filter.scope === "body") {
          this.applyBodyFilter(session, filter);
        }
      } catch (error) {
        logger.error("[RequestFilterEngine] Failed to apply provider filter", {
          filterId: filter.id,
          providerId,
          scope: filter.scope,
          action: filter.action,
          error,
        });
      }
    }
  }

  /** @deprecated Use applyGlobal() instead */
  async apply(session: ProxySession): Promise<void> {
    await this.applyGlobal(session);
  }

  // ---------------------------------------------------------------------------
  // Final phase (NEW)
  // ---------------------------------------------------------------------------

  /**
   * Apply final-phase filters after all forwarder-level overrides.
   * Operates on the provided body/headers directly (not session).
   */
  async applyFinal(
    session: ProxySession,
    body: Record<string, unknown>,
    headers: Headers
  ): Promise<void> {
    await this.ensureInitialized();

    const allFinal = this.collectFinalFilters(session);
    if (allFinal.length === 0) return;

    for (const filter of allFinal) {
      try {
        if (filter.ruleMode === "advanced" && filter.operations) {
          this.executeAdvancedOps(filter.operations, body, headers);
        } else {
          // simple mode: reuse existing logic but on body/headers directly
          this.applySimpleFilterDirect(filter, body, headers);
        }
      } catch (error) {
        logger.error("[RequestFilterEngine] Failed to apply final filter", {
          filterId: filter.id,
          ruleMode: filter.ruleMode,
          error,
        });
      }
    }

    // Transport header blacklist enforcement
    for (const h of TRANSPORT_HEADER_BLACKLIST) {
      headers.delete(h);
    }
  }

  /** Collect and sort final-phase filters matching the current provider */
  private collectFinalFilters(session: ProxySession): CachedRequestFilter[] {
    const result: CachedRequestFilter[] = [...this.globalFinalFilters];

    if (this.providerFinalFilters.length > 0 && session.provider) {
      const providerId = session.provider.id;

      let providerTagsSet: Set<string> | null = null;
      if (this.hasGroupBasedFinalFilters) {
        const providerGroupTag = session.provider.groupTag;
        providerTagsSet = new Set(providerGroupTag?.split(",").map((t) => t.trim()) ?? []);
      }

      for (const filter of this.providerFinalFilters) {
        let matches = false;

        if (filter.bindingType === "providers") {
          matches = filter.providerIdsSet?.has(providerId) ?? false;
        } else if (filter.bindingType === "groups" && providerTagsSet) {
          matches = filter.groupTagsSet
            ? Array.from(providerTagsSet).some((tag) => filter.groupTagsSet!.has(tag))
            : false;
        }

        if (matches) result.push(filter);
      }

      // Re-sort merged list by priority
      result.sort((a, b) => a.priority - b.priority || a.id - b.id);
    }

    return result;
  }

  /** Apply simple-mode filter on raw body/headers (not session) */
  private applySimpleFilterDirect(
    filter: CachedRequestFilter,
    body: Record<string, unknown>,
    headers: Headers
  ): void {
    if (filter.scope === "header") {
      const key = filter.target;
      switch (filter.action) {
        case "remove":
          headers.delete(key);
          break;
        case "set": {
          const value =
            typeof filter.replacement === "string"
              ? filter.replacement
              : filter.replacement !== null && filter.replacement !== undefined
                ? JSON.stringify(filter.replacement)
                : "";
          headers.set(key, value);
          break;
        }
        default:
          logger.warn("[RequestFilterEngine] Unsupported header action in final", {
            action: filter.action,
          });
      }
    } else if (filter.scope === "body") {
      switch (filter.action as RequestFilterAction) {
        case "json_path":
          setValueByPath(body, filter.target, filter.replacement ?? null);
          break;
        case "text_replace": {
          const replacementStr =
            typeof filter.replacement === "string"
              ? filter.replacement
              : JSON.stringify(filter.replacement ?? "");
          const replaced = this.deepReplace(
            body,
            filter.target,
            replacementStr,
            filter.matchType,
            filter.compiledRegex
          );
          // Merge replaced keys back into body
          if (replaced && typeof replaced === "object" && !Array.isArray(replaced)) {
            const replacedObj = replaced as Record<string, unknown>;
            for (const key of Object.keys(body)) {
              delete body[key];
            }
            Object.assign(body, replacedObj);
          }
          break;
        }
        default:
          logger.warn("[RequestFilterEngine] Unsupported body action in final", {
            action: filter.action,
          });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Advanced operation executors
  // ---------------------------------------------------------------------------

  private executeAdvancedOps(
    ops: FilterOperation[],
    body: Record<string, unknown>,
    headers: Headers
  ): void {
    for (const op of ops) {
      switch (op.op) {
        case "set":
          this.executeSetOp(op, body, headers);
          break;
        case "remove":
          this.executeRemoveOp(op, body, headers);
          break;
        case "merge":
          this.executeMergeOp(op, body);
          break;
        case "insert":
          this.executeInsertOp(op, body);
          break;
        default:
          logger.warn("[RequestFilterEngine] Unknown advanced op", {
            op: (op as FilterOperation).op,
          });
      }
    }
  }

  private executeSetOp(op: SetOp, body: Record<string, unknown>, headers: Headers): void {
    const writeMode = op.writeMode ?? "overwrite";

    if (op.scope === "header") {
      if (writeMode === "if_missing" && headers.has(op.path)) return;
      const value = typeof op.value === "string" ? op.value : JSON.stringify(op.value);
      headers.set(op.path, value);
    } else {
      if (writeMode === "if_missing" && getValueByPath(body, op.path) !== undefined) return;
      setValueByPath(body, op.path, op.value);
    }
  }

  private executeRemoveOp(op: RemoveOp, body: Record<string, unknown>, headers: Headers): void {
    if (op.scope === "header") {
      headers.delete(op.path);
      return;
    }

    if (op.matcher) {
      // Remove matching array elements
      const arr = getValueByPath(body, op.path);
      if (Array.isArray(arr)) {
        const filtered = arr.filter((el) => !matchElement(el, op.matcher!));
        setValueByPath(body, op.path, filtered);
      }
    } else {
      deleteByPath(body, op.path);
    }
  }

  private executeMergeOp(op: MergeOp, body: Record<string, unknown>): void {
    let target = getValueByPath(body, op.path);
    if (
      target === undefined ||
      target === null ||
      typeof target !== "object" ||
      Array.isArray(target)
    ) {
      // Create target object
      setValueByPath(body, op.path, {});
      target = getValueByPath(body, op.path);
    }

    if (target && typeof target === "object" && !Array.isArray(target)) {
      deepMerge(target as Record<string, unknown>, op.value);
    }
  }

  private executeInsertOp(op: InsertOp, body: Record<string, unknown>): void {
    let arr = getValueByPath(body, op.path);
    if (!Array.isArray(arr)) {
      // Create array at path
      setValueByPath(body, op.path, []);
      arr = getValueByPath(body, op.path);
      if (!Array.isArray(arr)) return;
    }

    // Dedupe check
    const dedupeEnabled = op.dedupe?.enabled !== false;
    if (dedupeEnabled) {
      const byFields = op.dedupe?.byFields;
      const exists = arr.some((existing) => {
        if (byFields && byFields.length > 0) {
          // Partial field comparison
          if (
            typeof existing !== "object" ||
            existing === null ||
            typeof op.value !== "object" ||
            op.value === null
          ) {
            return deepEqual(existing, op.value);
          }
          const existingObj = existing as Record<string, unknown>;
          const valueObj = op.value as Record<string, unknown>;
          return byFields.every((field) => deepEqual(existingObj[field], valueObj[field]));
        }
        return deepEqual(existing, op.value);
      });
      if (exists) return;
    }

    // Position resolution
    const position = op.position ?? "end";
    let insertIndex: number;

    switch (position) {
      case "start":
        insertIndex = 0;
        break;
      case "end":
        insertIndex = arr.length;
        break;
      case "before":
      case "after": {
        if (!op.anchor) {
          insertIndex = position === "before" ? 0 : arr.length;
          break;
        }
        const anchorIdx = arr.findIndex((el) => matchElement(el, op.anchor!));
        if (anchorIdx === -1) {
          // Anchor not found, apply fallback
          const fallback = op.onAnchorMissing ?? "end";
          if (fallback === "skip") return;
          insertIndex = fallback === "start" ? 0 : arr.length;
        } else {
          insertIndex = position === "before" ? anchorIdx : anchorIdx + 1;
        }
        break;
      }
      default:
        insertIndex = arr.length;
    }

    arr.splice(insertIndex, 0, op.value);
  }

  // ---------------------------------------------------------------------------
  // Guard-phase helpers (existing, unchanged)
  // ---------------------------------------------------------------------------

  private applyHeaderFilter(session: ProxySession, filter: CachedRequestFilter) {
    const key = filter.target;
    switch (filter.action) {
      case "remove":
        session.headers.delete(key);
        break;
      case "set": {
        const value =
          typeof filter.replacement === "string"
            ? filter.replacement
            : filter.replacement !== null && filter.replacement !== undefined
              ? JSON.stringify(filter.replacement)
              : "";
        session.headers.set(key, value);
        break;
      }
      default:
        logger.warn("[RequestFilterEngine] Unsupported header action", { action: filter.action });
    }
  }

  private applyBodyFilter(session: ProxySession, filter: CachedRequestFilter) {
    const message = session.request.message as Record<string, unknown>;

    switch (filter.action as RequestFilterAction) {
      case "json_path": {
        setValueByPath(message, filter.target, filter.replacement ?? null);
        break;
      }
      case "text_replace": {
        const replacementStr =
          typeof filter.replacement === "string"
            ? filter.replacement
            : JSON.stringify(filter.replacement ?? "");
        const replaced = this.deepReplace(
          message,
          filter.target,
          replacementStr,
          filter.matchType,
          filter.compiledRegex
        );
        session.request.message = replaced as typeof session.request.message;
        break;
      }
      default:
        logger.warn("[RequestFilterEngine] Unsupported body action", { action: filter.action });
    }
  }

  private deepReplace(
    value: unknown,
    target: string,
    replacement: string,
    matchType: RequestFilterMatchType,
    compiledRegex?: RegExp
  ): unknown {
    if (typeof value === "string") {
      return replaceText(value, target, replacement, matchType, compiledRegex);
    }

    if (Array.isArray(value)) {
      return value.map((item) =>
        this.deepReplace(item, target, replacement, matchType, compiledRegex)
      );
    }

    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = this.deepReplace(v, target, replacement, matchType, compiledRegex);
      }
      return result;
    }

    return value;
  }

  // ---------------------------------------------------------------------------
  // Test helpers
  // ---------------------------------------------------------------------------

  setFiltersForTest(filters: RequestFilter[]): void {
    this.loadFilters(filters);
  }

  getStats() {
    const total =
      this.globalGuardFilters.length +
      this.providerGuardFilters.length +
      this.globalFinalFilters.length +
      this.providerFinalFilters.length;
    return {
      count: total,
      lastReloadTime: this.lastReloadTime,
      isLoading: this.isLoading,
      isInitialized: this.isInitialized,
    };
  }
}

// Use globalThis to guarantee a single instance across workers
const g = globalThis as unknown as { __CCH_REQUEST_FILTER_ENGINE__?: RequestFilterEngine };
if (!g.__CCH_REQUEST_FILTER_ENGINE__) {
  g.__CCH_REQUEST_FILTER_ENGINE__ = new RequestFilterEngine();
}
export const requestFilterEngine = g.__CCH_REQUEST_FILTER_ENGINE__;
