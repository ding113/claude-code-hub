import safeRegex from "safe-regex";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { logger } from "@/lib/logger";
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

function parsePath(path: string): Array<string | number> {
  const parts: Array<string | number> = [];
  const regex = /([^.[\]]+)|(\[(\d+)\])/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(path)) !== null) {
    if (match[1]) {
      parts.push(match[1]);
    } else if (match[3]) {
      parts.push(Number(match[3]));
    }
  }
  return parts;
}

function setValueByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  // Optimization #6: Path validation
  if (!path || typeof path !== "string" || path.trim().length === 0) {
    logger.warn("[RequestFilterEngine] Invalid path in setValueByPath", { path });
    return;
  }

  const keys = parsePath(path);
  if (keys.length === 0) {
    logger.warn("[RequestFilterEngine] Empty keys after parsing path", { path });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic object traversal requires any
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
      // overwrite with object/array to continue traversal
      const nextKey = keys[i + 1];
      current[key] = typeof nextKey === "number" ? [] : {};
    }
    current = current[key] as Record<string | number, unknown>;
  }
}

function replaceText(
  input: string,
  target: string,
  replacement: string,
  matchType: RequestFilterMatchType,
  compiledRegex?: RegExp // Optimization #2: Use pre-compiled regex
): string {
  switch (matchType) {
    case "regex": {
      // Use pre-compiled regex if available
      if (compiledRegex) {
        try {
          // Clone regex to reset lastIndex
          const re = new RegExp(compiledRegex.source, compiledRegex.flags);
          return input.replace(re, replacement);
        } catch (error) {
          logger.error("[RequestFilterEngine] Regex replace failed", { error });
          return input;
        }
      }

      // Fallback to old logic (for backward compatibility)
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
      // "contains" or any unrecognized matchType defaults to simple string replacement
      if (!target) return input;
      return input.split(target).join(replacement);
    }
  }
}

export class RequestFilterEngine {
  private globalFilters: CachedRequestFilter[] = [];
  private providerFilters: CachedRequestFilter[] = [];
  private lastReloadTime = 0;
  private isLoading = false;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  // Optimization #1: Memory leak cleanup
  private eventEmitterCleanup: (() => void) | null = null;

  // Optimization #5: Skip tag parsing when no group filters
  private hasGroupBasedFilters = false;

  constructor() {
    // 延迟初始化事件监听（仅在 Node.js runtime 中）
    this.setupEventListener();
  }

  // Optimization #1: Store cleanup function to fix memory leak
  private async setupEventListener(): Promise<void> {
    if (typeof process !== "undefined" && process.env.NEXT_RUNTIME !== "edge") {
      try {
        const { eventEmitter } = await import("@/lib/event-emitter");
        const handler = () => {
          void this.reload();
        };
        eventEmitter.on("requestFiltersUpdated", handler);

        // Store cleanup function
        this.eventEmitterCleanup = () => {
          eventEmitter.off("requestFiltersUpdated", handler);
        };
      } catch {
        // 忽略导入错误
      }
    }
  }

  // Optimization #1: Public method for cleanup
  destroy(): void {
    if (this.eventEmitterCleanup) {
      this.eventEmitterCleanup();
      this.eventEmitterCleanup = null;
    }
  }

  async reload(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const { getActiveRequestFilters } = await import("@/repository/request-filters");
      const filters = await getActiveRequestFilters();

      // Optimization #2, #3: Pre-compile regex and create Set caches
      const cachedFilters = filters.map((f) => {
        const cached: CachedRequestFilter = { ...f };

        // Optimization #2: Pre-compile regex for text_replace (with ReDoS validation)
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

        // Optimization #3: Create Set caches for faster lookups
        if (f.bindingType === "providers" && f.providerIds) {
          cached.providerIdsSet = new Set(f.providerIds);
        }
        if (f.bindingType === "groups" && f.groupTags) {
          cached.groupTagsSet = new Set(f.groupTags);
        }

        return cached;
      });

      // Разделяем фильтры по типу привязки
      this.globalFilters = cachedFilters
        .filter((f) => f.bindingType === "global" || !f.bindingType)
        .sort((a, b) => a.priority - b.priority || a.id - b.id);

      this.providerFilters = cachedFilters
        .filter((f) => f.bindingType === "providers" || f.bindingType === "groups")
        .sort((a, b) => a.priority - b.priority || a.id - b.id);

      // Optimization #5: Cache whether we have group-based filters
      this.hasGroupBasedFilters = this.providerFilters.some((f) => f.bindingType === "groups");

      this.lastReloadTime = Date.now();
      this.isInitialized = true;
      logger.info("[RequestFilterEngine] Filters loaded", {
        globalCount: this.globalFilters.length,
        providerCount: this.providerFilters.length,
      });
    } catch (error) {
      logger.error("[RequestFilterEngine] Failed to reload filters", { error });
    } finally {
      this.isLoading = false;
    }
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

  /**
   * Применить глобальные фильтры (вызывается ДО выбора провайдера)
   */
  async applyGlobal(session: ProxySession): Promise<void> {
    // Optimization #4: Early exit if already initialized and empty
    if (this.isInitialized && this.globalFilters.length === 0) return;

    await this.ensureInitialized();
    if (this.globalFilters.length === 0) return;

    for (const filter of this.globalFilters) {
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

  /**
   * Применить фильтры для конкретного провайдера (вызывается ПОСЛЕ выбора провайдера)
   */
  async applyForProvider(session: ProxySession): Promise<void> {
    // Optimization #4: Early exit if already initialized and empty
    if (this.isInitialized && this.providerFilters.length === 0) return;

    await this.ensureInitialized();
    if (this.providerFilters.length === 0 || !session.provider) return;

    const providerId = session.provider.id;

    // Optimization #5: Only parse tags if we have group-based filters
    let providerTagsSet: Set<string> | null = null;
    if (this.hasGroupBasedFilters) {
      const providerGroupTag = session.provider.groupTag;
      providerTagsSet = new Set(providerGroupTag?.split(",").map((t) => t.trim()) ?? []);
    }

    for (const filter of this.providerFilters) {
      // Проверяем соответствие привязки
      let matches = false;

      if (filter.bindingType === "providers") {
        // Optimization #3: O(1) lookup instead of O(n)
        matches = filter.providerIdsSet?.has(providerId) ?? false;
      } else if (filter.bindingType === "groups" && providerTagsSet) {
        // Optimization #3: O(m) instead of O(m*n), iterate smaller set (provider tags)
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

  /**
   * @deprecated Используйте applyGlobal() вместо этого метода.
   * Оставлено для обратной совместимости.
   */
  async apply(session: ProxySession): Promise<void> {
    await this.applyGlobal(session);
  }

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
        // Optimization #2: Pass compiledRegex to deepReplace
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
    compiledRegex?: RegExp // Optimization #2: Propagate compiledRegex
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

  // 测试辅助：直接注入过滤器
  setFiltersForTest(filters: RequestFilter[]): void {
    // Apply same caching logic as reload()
    const cachedFilters = filters.map((f) => {
      const cached: CachedRequestFilter = { ...f };

      if (f.matchType === "regex" && f.action === "text_replace") {
        if (!safeRegex(f.target)) {
          logger.warn("[RequestFilterEngine] Skip unsafe regex in test", {
            filterId: f.id,
            target: f.target,
          });
        } else {
          try {
            cached.compiledRegex = new RegExp(f.target, "g");
          } catch (error) {
            logger.warn("[RequestFilterEngine] Failed to compile regex in test", {
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

    this.globalFilters = cachedFilters
      .filter((f) => f.bindingType === "global" || !f.bindingType)
      .sort((a, b) => a.priority - b.priority || a.id - b.id);
    this.providerFilters = cachedFilters
      .filter((f) => f.bindingType === "providers" || f.bindingType === "groups")
      .sort((a, b) => a.priority - b.priority || a.id - b.id);
    this.hasGroupBasedFilters = this.providerFilters.some((f) => f.bindingType === "groups");
    this.isInitialized = true;
    this.lastReloadTime = Date.now();
  }

  getStats() {
    return {
      count: this.globalFilters.length + this.providerFilters.length,
      lastReloadTime: this.lastReloadTime,
      isLoading: this.isLoading,
      isInitialized: this.isInitialized,
    };
  }
}

export const requestFilterEngine = new RequestFilterEngine();
