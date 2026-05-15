/**
 * Agent Pool - Connection caching for HTTP/HTTPS requests
 *
 * Provides Agent caching per endpoint to:
 * 1. Reuse connections across requests to the same endpoint
 * 2. Isolate connections between different endpoints (prevents SSL certificate issues)
 * 3. Support health management (mark unhealthy on SSL errors)
 * 4. Implement TTL-based expiration and LRU eviction
 */
import { socksDispatcher } from "fetch-socks";
import { Agent, type Dispatcher, ProxyAgent } from "undici";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";

/**
 * Agent Pool Configuration
 */
export interface AgentPoolConfig {
  /**
   * 最大 dispatcher 容量，通常包含 cached、retired，以及正在创建中的容量预留（默认：100）。
   * 同 cacheKey 退役中的活跃旧代可提供 1 个替换 credit，避免满载时硬过期/unhealthy 后无法重建。
   */
  maxTotalAgents: number;
  /** Agent TTL in milliseconds (default: 300000 = 5 minutes) */
  agentTtlMs: number;
  /** Connection idle timeout in milliseconds (default: 60000 = 1 minute) */
  connectionIdleTimeoutMs: number;
  /** Cleanup interval in milliseconds (default: 30000 = 30 seconds) */
  cleanupIntervalMs: number;
}

/**
 * Cached Agent entry
 */
interface CachedAgent {
  /**
   * Unique dispatcher identity (generation token).
   *
   * 与 cacheKey 不同：cacheKey 只代表"哪个端点 + 代理 + 协议"，同一个 key 在驱逐/硬过期后
   * 会对应新的 dispatcher 实例。为了避免旧请求的 release 把新实例的 activeRequests 错减，
   * 每次创建都生成新的 id，release 时必须校验归属。
   */
  id: string;
  agent: Dispatcher;
  endpointKey: string;
  createdAt: number;
  lastUsedAt: number;
  requestCount: number;
  healthy: boolean;
  /** Number of in-flight requests using this agent (prevents premature eviction) */
  activeRequests: number;
}

type AgentRetirementReason = "unhealthy" | "expired" | "lru" | "endpoint";

interface RetiredAgent extends CachedAgent {
  cacheKey: string;
  retiredAt: number;
  retiredBy: AgentRetirementReason;
  retireReason: string;
}

/**
 * Agent Pool Statistics
 */
export interface AgentPoolStats {
  cacheSize: number;
  /** Retired dispatcher generations still waiting for in-flight requests to finish */
  retiredAgents: number;
  /** Total live dispatcher generations: cached + retired */
  liveAgents: number;
  /** Pending dispatcher creations that have reserved capacity */
  pendingCreations: number;
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  unhealthyAgents: number;
  evictedAgents: number;
  /** Total in-flight requests across cached and retired agents */
  activeRequests: number;
}

/**
 * Get Agent parameters
 */
export interface GetAgentParams {
  endpointUrl: string;
  proxyUrl: string | null;
  enableHttp2: boolean;
}

/**
 * Get Agent result
 */
export interface GetAgentResult {
  agent: Dispatcher;
  isNew: boolean;
  cacheKey: string;
  /**
   * Dispatcher generation id. 必须在 releaseAgent 时回传，防止跨代误减。
   * 若调用者拿到的 dispatcher 被驱逐后重建，release 会基于 id 校验并忽略无效请求。
   */
  dispatcherId: string;
}

/**
 * Agent Pool interface
 */
export interface AgentPool {
  /**
   * Get or create an Agent for the given parameters
   */
  getAgent(params: GetAgentParams): Promise<GetAgentResult>;

  /**
   * Release an agent after a request (including streaming body) has completed.
   *
   * 必须同时传入 dispatcherId —— 仅当当前缓存条目的 id 与传入值完全匹配时才会减 1。
   * 这样即便 cacheKey 对应的 dispatcher 在驱逐/硬过期后被重建，旧请求的 release
   * 也不会误减新实例的 activeRequests，从而避免"新连接刚建起就被提前驱逐"。
   */
  releaseAgent(cacheKey: string, dispatcherId: string): void;

  /**
   * Mark one dispatcher generation as unhealthy.
   *
   * 空闲 dispatcher 会立即关闭；仍有在途请求的 dispatcher 会被退役，
   * 等对应请求全部 release 后再关闭。dispatcherId 必须来自 getAgent()
   * 返回值，避免旧请求迟到错误误伤同 cacheKey 的新 dispatcher。
   */
  markUnhealthy(cacheKey: string, reason: string, dispatcherId: string): void;

  /**
   * Evict all Agents for a specific endpoint
   */
  evictEndpoint(endpointKey: string): Promise<void>;

  /**
   * Get pool statistics
   */
  getPoolStats(): AgentPoolStats;

  /**
   * Cleanup expired Agents
   * @returns Number of agents cleaned up
   */
  cleanup(): Promise<number>;

  /**
   * Shutdown the pool and close all agents
   */
  shutdown(): Promise<void>;
}

/**
 * Generate cache key for Agent lookup
 *
 * Format: "${endpointOrigin}|${proxyOrigin || 'direct'}|${h2 ? 'h2' : 'h1'}"
 * Note: Only uses proxy origin (without credentials) to avoid exposing sensitive data in logs/metrics
 */
export function generateAgentCacheKey(params: GetAgentParams): string {
  const url = new URL(params.endpointUrl);
  const origin = url.origin;
  let proxy = "direct";
  if (params.proxyUrl) {
    // SOCKS URLs (socks4://, socks5://) are not standard HTTP URLs and the URL API
    // returns "null" for origin. Handle them specially by extracting protocol://host:port
    if (params.proxyUrl.startsWith("socks4://") || params.proxyUrl.startsWith("socks5://")) {
      // Parse manually: socks5://[user:pass@]host:port
      const match = params.proxyUrl.match(/^(socks[45]):\/\/(?:[^@]+@)?([^:/?#]+)(?::(\d+))?/);
      if (match) {
        const protocol = match[1];
        const host = match[2];
        const port = match[3] || (protocol === "socks5" ? "1080" : "1080");
        proxy = `${protocol}://${host}:${port}`;
      } else {
        proxy = params.proxyUrl; // Fallback to original URL
      }
    } else {
      const proxyUrl = new URL(params.proxyUrl);
      // Use only origin (protocol + host + port) to avoid exposing credentials
      proxy = proxyUrl.origin;
    }
  }
  const protocol = params.enableHttp2 ? "h2" : "h1";
  return `${origin}|${proxy}|${protocol}`;
}

/**
 * Default Agent Pool configuration
 */
const DEFAULT_CONFIG: AgentPoolConfig = {
  maxTotalAgents: 100,
  agentTtlMs: 300000, // 5 minutes
  connectionIdleTimeoutMs: 60000, // 1 minute
  cleanupIntervalMs: 30000, // 30 seconds
};

const MAX_AGENT_LIFETIME_MS = 30 * 60 * 1000;
const MAX_RETIRED_AGENT_LIFETIME_MS = 6 * 60 * 60 * 1000;

/**
 * Agent Pool Implementation
 */
export class AgentPoolImpl implements AgentPool {
  private cache: Map<string, CachedAgent> = new Map();
  private retiredAgents: Map<string, RetiredAgent> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown = false;
  private config: AgentPoolConfig;
  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    evictedAgents: 0,
  };
  /** Pending agent creation promises to prevent race conditions */
  private pendingCreations: Map<string, Promise<GetAgentResult>> = new Map();
  /** Monotonic counter for generating unique dispatcher ids per creation */
  private dispatcherIdCounter = 0;
  /**
   * Pending destroy/close promises (best-effort).
   *
   * 说明：
   * - 驱逐/清理路径为了避免全局卡死，必须 fire-and-forget（不 await）。
   * - 但在 shutdown() 中我们仍希望尽量“优雅收尾”，因此在这里追踪 pending 的关闭任务。
   * - 若某些 dispatcher 永不 settle，这里会在超时后丢弃引用，避免内存泄漏。
   */
  private pendingCleanups: Set<Promise<void>> = new Set();

  constructor(config: Partial<AgentPoolConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupTimer();
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cleanupTimer = setInterval(() => {
      void this.cleanup();
    }, this.config.cleanupIntervalMs);
    // Allow process to exit gracefully without waiting for cleanup timer
    this.cleanupTimer.unref();
  }

  async getAgent(params: GetAgentParams): Promise<GetAgentResult> {
    if (this.isShuttingDown) {
      throw new Error("AgentPool is shutting down");
    }

    const cacheKey = generateAgentCacheKey(params);

    // Try to get from cache
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    const expirationReason = cached ? this.getExpirationReason(cached, now) : null;
    if (cached?.healthy && !expirationReason) {
      cached.lastUsedAt = now;
      cached.requestCount++;
      cached.activeRequests++;
      this.stats.totalRequests++;
      this.stats.cacheHits++;
      return { agent: cached.agent, isNew: false, cacheKey, dispatcherId: cached.id };
    }

    if (cached) {
      // markUnhealthy 会同步驱逐当前 cache entry，因此这里的 cached entry 只会是已过期的健康实例。
      const retireReason =
        now - cached.createdAt > MAX_AGENT_LIFETIME_MS
          ? "hard lifetime exceeded before reuse"
          : "ttl expired before reuse";
      this.evictByKey(cacheKey, "expired", retireReason);
    }

    // Check if there's a pending creation for this key (race condition prevention)
    const pending = this.pendingCreations.get(cacheKey);
    if (pending) {
      // Wait for the pending creation and return its result
      const result = await pending;
      // ⚠️ 关键：等待 pending 创建的调用者也必须计入 activeRequests。
      // 创建者在 createAgentWithCache 里把 activeRequests 初始化为 1（只代表它自己），
      // 这里的每个等待者都要再 +1，否则一旦创建者完成并减到 0，cleanup/LRU 会在其它
      // 仍在飞行中的请求头上把共享 agent 驱逐掉，又会把 STREAM_PROCESSING_ERROR 带回来。
      const currentCached = this.cache.get(cacheKey);
      if (currentCached && currentCached.id === result.dispatcherId) {
        currentCached.activeRequests++;
        currentCached.lastUsedAt = Date.now();
      } else {
        const retired = this.retiredAgents.get(result.dispatcherId);
        if (retired && retired.cacheKey === cacheKey) {
          retired.activeRequests++;
          retired.lastUsedAt = Date.now();
        }
      }
      // Count as cache hit - we're reusing the pending result, not creating a new agent
      // Note: Don't decrement cacheMisses here since we never incremented it for this request
      this.stats.totalRequests++;
      this.stats.cacheHits++;
      return { ...result, isNew: false };
    }

    this.ensureCapacityForNewAgent(cacheKey);

    // Cache miss - create new agent with race condition protection
    this.stats.totalRequests++;
    this.stats.cacheMisses++;

    // Create the agent creation promise and store it
    const creationPromise = this.createAgentWithCache(params, cacheKey);
    this.pendingCreations.set(cacheKey, creationPromise);

    try {
      return await creationPromise;
    } finally {
      // Clean up pending creation
      this.pendingCreations.delete(cacheKey);
    }
  }

  /**
   * Internal method to create agent and update cache
   * Separated to enable race condition protection via Promise caching
   */
  private async createAgentWithCache(
    params: GetAgentParams,
    cacheKey: string
  ): Promise<GetAgentResult> {
    // Create new agent
    const agent = await this.createAgent(params);
    if (this.isShuttingDown) {
      void this.closeAgent(agent, cacheKey);
      throw new Error("AgentPool is shutting down");
    }

    const url = new URL(params.endpointUrl);
    const dispatcherId = `disp-${++this.dispatcherIdCounter}`;

    const newCached: CachedAgent = {
      id: dispatcherId,
      agent,
      endpointKey: url.origin,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      requestCount: 1,
      healthy: true,
      activeRequests: 1,
    };

    this.cache.set(cacheKey, newCached);

    // Enforce max size (LRU eviction)
    this.enforceMaxSize();

    return { agent, isNew: true, cacheKey, dispatcherId };
  }

  releaseAgent(cacheKey: string, dispatcherId: string): void {
    const cached = this.cache.get(cacheKey);
    // 必须校验 dispatcher 身份：如果 cacheKey 已经指向新生成的 dispatcher，
    // 说明调用者对应的老 dispatcher 已经被驱逐（30 分钟硬过期 / markUnhealthy / LRU），
    // 这时候直接忽略，避免把新实例的 activeRequests 错减 1 触发提前驱逐。
    if (cached && cached.id === dispatcherId && cached.activeRequests > 0) {
      cached.activeRequests--;
      cached.lastUsedAt = Date.now(); // refresh TTL from stream completion
      return;
    }

    const retired = this.retiredAgents.get(dispatcherId);
    if (retired && retired.cacheKey === cacheKey && retired.activeRequests > 0) {
      retired.activeRequests--;
      retired.lastUsedAt = Date.now();

      if (retired.activeRequests === 0) {
        this.retiredAgents.delete(dispatcherId);
        void this.closeAgent(retired.agent, cacheKey);
      }
    }
  }

  markUnhealthy(cacheKey: string, reason: string, dispatcherId: string): void {
    const cached = this.cache.get(cacheKey);
    if (cached && cached.id === dispatcherId) {
      cached.healthy = false;
      this.evictByKey(cacheKey, "unhealthy", reason);
      logger.warn("AgentPool: Agent marked as unhealthy", {
        cacheKey,
        dispatcherId: cached.id,
        reason,
      });
      return;
    }

    const retired = this.retiredAgents.get(dispatcherId);
    if (retired && retired.cacheKey === cacheKey) {
      retired.healthy = false;
      retired.retiredBy = "unhealthy";
      retired.retireReason = reason;
      logger.warn("AgentPool: Retired agent marked as unhealthy", {
        cacheKey,
        dispatcherId,
        reason,
      });
      return;
    }

    logger.debug("AgentPool: Ignored stale unhealthy mark", {
      cacheKey,
      dispatcherId,
      currentDispatcherId: cached?.id ?? null,
      reason,
    });
  }

  async evictEndpoint(endpointKey: string): Promise<void> {
    const keysToEvict: string[] = [];

    for (const [key, cached] of this.cache.entries()) {
      if (cached.endpointKey === endpointKey) {
        keysToEvict.push(key);
      }
    }

    for (const key of keysToEvict) {
      this.evictByKey(key, "endpoint", "endpoint eviction");
    }
  }

  getPoolStats(): AgentPoolStats {
    let unhealthyCount = 0;
    const hitRate =
      this.stats.totalRequests > 0 ? this.stats.cacheHits / this.stats.totalRequests : 0;

    let activeRequests = 0;
    for (const cached of this.cache.values()) {
      activeRequests += cached.activeRequests;
      if (!cached.healthy) unhealthyCount++;
    }
    for (const retired of this.retiredAgents.values()) {
      activeRequests += retired.activeRequests;
      if (!retired.healthy) unhealthyCount++;
    }

    return {
      cacheSize: this.cache.size,
      retiredAgents: this.retiredAgents.size,
      liveAgents: this.getLiveDispatcherCount(),
      pendingCreations: this.pendingCreations.size,
      totalRequests: this.stats.totalRequests,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      hitRate,
      unhealthyAgents: unhealthyCount,
      evictedAgents: this.stats.evictedAgents,
      activeRequests,
    };
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    const keysToCleanup: string[] = [];

    for (const [key, cached] of this.cache.entries()) {
      if (this.getExpirationReason(cached, now)) {
        keysToCleanup.push(key);
      }
    }

    let cleanedFromCache = 0;
    for (const key of keysToCleanup) {
      if (this.evictByKey(key, "expired", "ttl cleanup")) {
        cleanedFromCache++;
      }
    }

    const cleanedFromRetired = this.cleanupRetiredAgents(now);
    const cleaned = cleanedFromCache + cleanedFromRetired;

    if (cleaned > 0) {
      logger.debug("AgentPool: Cleaned up expired agents", {
        fromCache: cleanedFromCache,
        fromRetired: cleanedFromRetired,
        total: cleaned,
      });
    }

    return cleaned;
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // closeAgent 本身是 fire-and-forget（不 await destroy/close），这里并行触发即可。
    await Promise.allSettled([
      ...Array.from(this.cache.entries()).map(([key, cached]) =>
        this.closeAgent(cached.agent, key)
      ),
      ...Array.from(this.retiredAgents.values()).map((retired) =>
        this.closeAgent(retired.agent, retired.cacheKey)
      ),
    ]);

    // Best-effort：等待部分 pending cleanup 完成，但永不无限等待（避免重蹈 “close() 等待 in-flight” 的覆辙）
    if (this.pendingCleanups.size > 0) {
      const pending = Array.from(this.pendingCleanups);
      const WAIT_MS = 2000;
      let timeoutId: NodeJS.Timeout | null = null;
      try {
        await Promise.race([
          Promise.allSettled(pending).then(() => {}),
          new Promise<void>((resolve) => {
            timeoutId = setTimeout(resolve, WAIT_MS);
            timeoutId.unref();
          }),
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      this.pendingCleanups.clear();
    }

    this.cache.clear();
    this.retiredAgents.clear();
    this.pendingCreations.clear();

    logger.info("AgentPool: Shutdown complete");
  }

  private getExpirationReason(cached: CachedAgent, now: number = Date.now()): "expired" | null {
    // 30 分钟后不再把这个 dispatcher 分配给新请求。
    // 正在传输的流只会被退役，不会被立刻 destroy，等自身 release 后再关闭。
    if (now - cached.createdAt > MAX_AGENT_LIFETIME_MS) return "expired";

    // 普通 TTL 不清理仍有在途请求的 dispatcher。
    if (cached.activeRequests > 0) return null;

    return now - cached.lastUsedAt > this.config.agentTtlMs ? "expired" : null;
  }

  private evictByKey(key: string, retiredBy: AgentRetirementReason, retireReason: string): boolean {
    const cached = this.cache.get(key);
    if (!cached) {
      return false;
    }

    this.cache.delete(key);
    this.stats.evictedAgents++;
    this.disposeCachedAgent(key, cached, retiredBy, retireReason);
    return true;
  }

  private disposeCachedAgent(
    key: string,
    cached: CachedAgent,
    retiredBy: AgentRetirementReason,
    retireReason: string
  ): void {
    if (cached.activeRequests > 0) {
      const retired: RetiredAgent = {
        ...cached,
        cacheKey: key,
        healthy: retiredBy === "unhealthy" ? false : cached.healthy,
        retiredAt: Date.now(),
        retiredBy,
        retireReason,
      };
      this.retiredAgents.set(cached.id, retired);
      logger.debug("AgentPool: Retired active agent", {
        cacheKey: key,
        dispatcherId: cached.id,
        activeRequests: cached.activeRequests,
        retiredBy,
      });
      return;
    }

    void this.closeAgent(cached.agent, key);
  }

  private cleanupRetiredAgents(now: number): number {
    let cleaned = 0;
    for (const [dispatcherId, retired] of this.retiredAgents.entries()) {
      const activeTooLong =
        retired.activeRequests > 0 && now - retired.retiredAt > MAX_RETIRED_AGENT_LIFETIME_MS;
      if (retired.activeRequests > 0 && !activeTooLong) {
        continue;
      }

      if (activeTooLong) {
        logger.warn("AgentPool: Force closing long-retired active agent", {
          cacheKey: retired.cacheKey,
          dispatcherId,
          activeRequests: retired.activeRequests,
          retiredBy: retired.retiredBy,
          retiredForMs: now - retired.retiredAt,
        });
      }

      this.retiredAgents.delete(dispatcherId);
      void this.closeAgent(retired.agent, retired.cacheKey);
      cleaned++;
    }

    return cleaned;
  }

  private async closeAgent(agent: Dispatcher, key: string): Promise<void> {
    // 防御性处理：极端情况下（例如 mock/第三方 dispatcher 异常）可能传入空值
    if (!agent) return;

    try {
      // 注意：优先 destroy。undici 的 close() 可能会等待 in-flight 请求结束（流式/卡住时会导致长期阻塞），
      // 从而让 getAgent/evictEndpoint/cleanup 也被卡住，最终表现为“所有请求都卡在 requesting”。
      // destroy() 会强制关闭底层连接，更适合作为驱逐/清理时的兜底手段。
      const operation =
        typeof agent.destroy === "function"
          ? ("destroy" as const)
          : typeof agent.close === "function"
            ? ("close" as const)
            : null;

      // 关键点：驱逐/清理路径不能等待 in-flight（否则会把 getAgent() 也阻塞住，导致全局“requesting”）
      // 因此这里发起 destroy/close 后不 await，仅记录异常，确保 eviction 始终快速返回。
      // 同时将 promise 纳入 pendingCleanups，便于 shutdown() 做 best-effort 的“优雅收尾”。
      const cleanupPromise =
        operation === "destroy" ? agent.destroy() : operation === "close" ? agent.close() : null;

      if (!cleanupPromise) return;

      let dropRefTimeoutId: NodeJS.Timeout | null = null;

      const trackedPromise: Promise<void> = cleanupPromise
        .catch((error) => {
          logger.warn("AgentPool: Error closing agent", {
            key,
            operation,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          if (dropRefTimeoutId) clearTimeout(dropRefTimeoutId);
          this.pendingCleanups.delete(trackedPromise);
        });

      this.pendingCleanups.add(trackedPromise);

      // 避免某些 dispatcher 永不 settle 导致 pendingCleanups 长期持有引用
      dropRefTimeoutId = setTimeout(() => {
        this.pendingCleanups.delete(trackedPromise);
      }, 60000);
      dropRefTimeoutId.unref();
    } catch (error) {
      logger.warn("AgentPool: Error closing agent", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private getLiveDispatcherCount(): number {
    return this.cache.size + this.retiredAgents.size;
  }

  private getReplacementCapacityCredit(cacheKey: string): number {
    // 同 cacheKey 的退役活跃旧代原本占用的是这个逻辑槽位。允许最多 1 个替换 credit，
    // 让硬过期/unhealthy 后能重建当前可复用代；更多旧代仍计入容量，避免无限堆积。
    for (const retired of this.retiredAgents.values()) {
      if (retired.cacheKey === cacheKey && retired.activeRequests > 0) {
        return 1;
      }
    }
    return 0;
  }

  private getReservedDispatcherCount(replacementCacheKey?: string): number {
    let reserved = this.getLiveDispatcherCount();
    for (const cacheKey of this.pendingCreations.keys()) {
      // 创建完成到 finally 删除 pending 之间，cache 里已经有同 key dispatcher，
      // 此时不要把 pending 和 cache 重复计数。
      if (!this.cache.has(cacheKey)) {
        reserved++;
      }
    }
    if (replacementCacheKey) {
      reserved -= this.getReplacementCapacityCredit(replacementCacheKey);
    }
    return Math.max(0, reserved);
  }

  private ensureCapacityForNewAgent(cacheKey: string): void {
    this.reclaimCapacityForNewAgent(cacheKey);

    if (this.getReservedDispatcherCount(cacheKey) < this.config.maxTotalAgents) {
      return;
    }

    const reservedDispatchers = this.getReservedDispatcherCount();
    const replacementCapacityCredit = this.getReplacementCapacityCredit(cacheKey);
    logger.warn("AgentPool: Live dispatcher capacity exhausted", {
      cacheKey,
      maxTotalAgents: this.config.maxTotalAgents,
      reservedDispatchers,
      effectiveReservedDispatchers: Math.max(0, reservedDispatchers - replacementCapacityCredit),
      replacementCapacityCredit,
      cacheSize: this.cache.size,
      retiredAgents: this.retiredAgents.size,
      pendingCreations: this.pendingCreations.size,
      activeRequests: this.getPoolStats().activeRequests,
    });

    throw new Error(`AgentPool live dispatcher capacity exhausted: ${this.config.maxTotalAgents}`);
  }

  private reclaimCapacityForNewAgent(cacheKey: string): void {
    if (this.getReservedDispatcherCount() < this.config.maxTotalAgents) {
      return;
    }

    this.cleanupRetiredAgents(Date.now());

    if (this.getReservedDispatcherCount(cacheKey) < this.config.maxTotalAgents) {
      return;
    }

    this.evictIdleCachedAgentsUntilBelowLimit();
  }

  private enforceMaxSize(): void {
    if (this.getReservedDispatcherCount() <= this.config.maxTotalAgents) {
      return;
    }

    this.cleanupRetiredAgents(Date.now());

    if (this.getReservedDispatcherCount() <= this.config.maxTotalAgents) {
      return;
    }

    this.evictIdleCachedAgentsUntilAtLimit();
  }

  private evictIdleCachedAgentsUntilBelowLimit(): void {
    this.evictIdleCachedAgents((reserved) => reserved < this.config.maxTotalAgents);
  }

  private evictIdleCachedAgentsUntilAtLimit(): void {
    this.evictIdleCachedAgents((reserved) => reserved <= this.config.maxTotalAgents);
  }

  private evictIdleCachedAgents(isWithinLimit: (reserved: number) => boolean): void {
    const now = Date.now();

    // LRU 只回收空闲 dispatcher。活跃 dispatcher 已经代表真实在途请求；
    // 继续把它们转入 retired 不能释放 live 容量，只会突破 maxTotalAgents 的连接预算。
    const idleEntries = Array.from(this.cache.entries())
      .filter(([, cached]) => cached.activeRequests === 0)
      .sort(([, a], [, b]) => {
        const aExpired = this.getExpirationReason(a, now) ? 0 : 1;
        const bExpired = this.getExpirationReason(b, now) ? 0 : 1;
        if (aExpired !== bExpired) return aExpired - bExpired;
        return a.lastUsedAt - b.lastUsedAt;
      });

    for (const [key] of idleEntries) {
      if (isWithinLimit(this.getReservedDispatcherCount())) {
        break;
      }
      this.evictByKey(key, "lru", "max live dispatcher capacity exceeded");
    }
  }

  private async createAgent(params: GetAgentParams): Promise<Dispatcher> {
    const {
      FETCH_CONNECT_TIMEOUT: connectTimeout,
      FETCH_HEADERS_TIMEOUT: headersTimeout,
      FETCH_BODY_TIMEOUT: bodyTimeout,
    } = getEnvConfig();

    // No proxy - create direct Agent
    if (!params.proxyUrl) {
      return new Agent({
        connectTimeout,
        headersTimeout,
        bodyTimeout,
        allowH2: params.enableHttp2,
      });
    }

    const proxyUrl = params.proxyUrl.trim();
    const parsedProxy = new URL(proxyUrl);

    // SOCKS proxy
    if (parsedProxy.protocol === "socks5:" || parsedProxy.protocol === "socks4:") {
      return socksDispatcher(
        {
          type: parsedProxy.protocol === "socks5:" ? 5 : 4,
          host: parsedProxy.hostname,
          port: parseInt(parsedProxy.port, 10) || 1080,
          userId: parsedProxy.username || undefined,
          password: parsedProxy.password || undefined,
        },
        {
          connect: {
            timeout: connectTimeout,
          },
        }
      );
    }

    // HTTP/HTTPS proxy
    if (parsedProxy.protocol === "http:" || parsedProxy.protocol === "https:") {
      return new ProxyAgent({
        uri: proxyUrl,
        allowH2: params.enableHttp2,
        connectTimeout,
        headersTimeout,
        bodyTimeout,
      });
    }

    throw new Error(`Unsupported proxy protocol: ${parsedProxy.protocol}`);
  }
}

// Global singleton instance
let globalAgentPool: AgentPool | null = null;

/**
 * Get the global Agent Pool singleton
 */
export function getGlobalAgentPool(): AgentPool {
  if (!globalAgentPool) {
    globalAgentPool = new AgentPoolImpl();
    logger.info("AgentPool: Global instance created");
  }
  return globalAgentPool;
}

/**
 * Reset the global Agent Pool (for testing)
 */
export async function resetGlobalAgentPool(): Promise<void> {
  if (globalAgentPool) {
    await globalAgentPool.shutdown();
    globalAgentPool = null;
  }
}
