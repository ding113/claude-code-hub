import safeRegex from "safe-regex";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { logger } from "@/lib/logger";
import type {
  RequestFilter,
  RequestFilterAction,
  RequestFilterMatchType,
} from "@/repository/request-filters";

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
  const keys = parsePath(path);
  if (keys.length === 0) return;

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
  matchType: RequestFilterMatchType
): string {
  switch (matchType) {
    case "regex": {
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
  private filters: RequestFilter[] = [];
  private lastReloadTime = 0;
  private isLoading = false;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    // 延迟初始化事件监听（仅在 Node.js runtime 中）
    this.setupEventListener();
  }

  private async setupEventListener(): Promise<void> {
    if (typeof process !== "undefined" && process.env.NEXT_RUNTIME !== "edge") {
      try {
        const { eventEmitter } = await import("@/lib/event-emitter");
        eventEmitter.on("requestFiltersUpdated", () => {
          void this.reload();
        });
      } catch {
        // 忽略导入错误
      }
    }
  }

  async reload(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const { getActiveRequestFilters } = await import("@/repository/request-filters");
      const filters = await getActiveRequestFilters();
      // 按优先级升序、id 升序排序，确保执行顺序稳定
      filters.sort((a, b) => a.priority - b.priority || a.id - b.id);
      this.filters = filters;
      this.lastReloadTime = Date.now();
      this.isInitialized = true;
      logger.info("[RequestFilterEngine] Filters loaded", { count: filters.length });
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

  async apply(session: ProxySession): Promise<void> {
    await this.ensureInitialized();
    if (this.filters.length === 0) return;

    for (const filter of this.filters) {
      try {
        if (filter.scope === "header") {
          this.applyHeaderFilter(session, filter);
        } else if (filter.scope === "body") {
          this.applyBodyFilter(session, filter);
        }
      } catch (error) {
        logger.error("[RequestFilterEngine] Failed to apply filter", {
          filterId: filter.id,
          scope: filter.scope,
          action: filter.action,
          error,
        });
      }
    }
  }

  private applyHeaderFilter(session: ProxySession, filter: RequestFilter) {
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

  private applyBodyFilter(session: ProxySession, filter: RequestFilter) {
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
        const replaced = this.deepReplace(message, filter.target, replacementStr, filter.matchType);
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
    matchType: RequestFilterMatchType
  ): unknown {
    if (typeof value === "string") {
      return replaceText(value, target, replacement, matchType);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.deepReplace(item, target, replacement, matchType));
    }

    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = this.deepReplace(v, target, replacement, matchType);
      }
      return result;
    }

    return value;
  }

  // 测试辅助：直接注入过滤器
  setFiltersForTest(filters: RequestFilter[]): void {
    this.filters = [...filters];
    this.isInitialized = true;
    this.lastReloadTime = Date.now();
  }

  getStats() {
    return {
      count: this.filters.length,
      lastReloadTime: this.lastReloadTime,
      isLoading: this.isLoading,
      isInitialized: this.isInitialized,
    };
  }
}

export const requestFilterEngine = new RequestFilterEngine();
