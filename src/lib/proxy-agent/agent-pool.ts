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
  /** Maximum total number of cached agents (default: 100) */
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
  agent: Dispatcher;
  endpointKey: string;
  createdAt: number;
  lastUsedAt: number;
  requestCount: number;
  healthy: boolean;
}

/**
 * Agent Pool Statistics
 */
export interface AgentPoolStats {
  cacheSize: number;
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  unhealthyAgents: number;
  evictedAgents: number;
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
   * Mark an Agent as unhealthy (will be replaced on next getAgent call)
   */
  markUnhealthy(cacheKey: string, reason: string): void;

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

/**
 * Agent Pool Implementation
 */
export class AgentPoolImpl implements AgentPool {
  private cache: Map<string, CachedAgent> = new Map();
  private unhealthyKeys: Set<string> = new Set();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private config: AgentPoolConfig;
  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    evictedAgents: 0,
  };
  /** Pending agent creation promises to prevent race conditions */
  private pendingCreations: Map<string, Promise<GetAgentResult>> = new Map();

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
    const cacheKey = generateAgentCacheKey(params);
    this.stats.totalRequests++;

    // Check if marked as unhealthy
    if (this.unhealthyKeys.has(cacheKey)) {
      this.unhealthyKeys.delete(cacheKey);
      await this.evictByKey(cacheKey);
    }

    // Try to get from cache
    const cached = this.cache.get(cacheKey);
    if (cached && !this.isExpired(cached)) {
      cached.lastUsedAt = Date.now();
      cached.requestCount++;
      this.stats.cacheHits++;
      return { agent: cached.agent, isNew: false, cacheKey };
    }

    // Check if there's a pending creation for this key (race condition prevention)
    const pending = this.pendingCreations.get(cacheKey);
    if (pending) {
      // Wait for the pending creation and return its result
      const result = await pending;
      // Count as cache hit - we're reusing the pending result, not creating a new agent
      // Note: Don't decrement cacheMisses here since we never incremented it for this request
      this.stats.cacheHits++;
      return { ...result, isNew: false };
    }

    // Cache miss - create new agent with race condition protection
    this.stats.cacheMisses++;

    // Create the agent creation promise and store it
    const creationPromise = this.createAgentWithCache(params, cacheKey, cached);
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
    cacheKey: string,
    existingCached: CachedAgent | undefined
  ): Promise<GetAgentResult> {
    // Evict old entry if exists
    if (existingCached) {
      await this.evictByKey(cacheKey);
    }

    // Create new agent
    const agent = await this.createAgent(params);
    const url = new URL(params.endpointUrl);

    const newCached: CachedAgent = {
      agent,
      endpointKey: url.origin,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      requestCount: 1,
      healthy: true,
    };

    this.cache.set(cacheKey, newCached);

    // Enforce max size (LRU eviction)
    await this.enforceMaxSize();

    return { agent, isNew: true, cacheKey };
  }

  markUnhealthy(cacheKey: string, reason: string): void {
    this.unhealthyKeys.add(cacheKey);
    logger.warn("AgentPool: Agent marked as unhealthy", {
      cacheKey,
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
      await this.evictByKey(key);
    }
  }

  getPoolStats(): AgentPoolStats {
    const unhealthyCount = this.unhealthyKeys.size;
    const hitRate =
      this.stats.totalRequests > 0 ? this.stats.cacheHits / this.stats.totalRequests : 0;

    return {
      cacheSize: this.cache.size,
      totalRequests: this.stats.totalRequests,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      hitRate,
      unhealthyAgents: unhealthyCount,
      evictedAgents: this.stats.evictedAgents,
    };
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    const keysToCleanup: string[] = [];

    for (const [key, cached] of this.cache.entries()) {
      if (this.isExpired(cached, now)) {
        keysToCleanup.push(key);
      }
    }

    for (const key of keysToCleanup) {
      await this.evictByKey(key);
    }

    if (keysToCleanup.length > 0) {
      logger.debug("AgentPool: Cleaned up expired agents", {
        count: keysToCleanup.length,
      });
    }

    return keysToCleanup.length;
  }

  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    const closePromises: Promise<void>[] = [];

    for (const [key, cached] of this.cache.entries()) {
      closePromises.push(this.closeAgent(cached.agent, key));
    }

    await Promise.all(closePromises);
    this.cache.clear();
    this.unhealthyKeys.clear();

    logger.info("AgentPool: Shutdown complete");
  }

  private isExpired(cached: CachedAgent, now: number = Date.now()): boolean {
    return now - cached.lastUsedAt > this.config.agentTtlMs;
  }

  private async evictByKey(key: string): Promise<void> {
    const cached = this.cache.get(key);
    if (cached) {
      await this.closeAgent(cached.agent, key);
      this.cache.delete(key);
      this.stats.evictedAgents++;
    }
  }

  private async closeAgent(agent: Dispatcher, key: string): Promise<void> {
    try {
      if (typeof agent.close === "function") {
        await agent.close();
      } else if (typeof agent.destroy === "function") {
        await agent.destroy();
      }
    } catch (error) {
      logger.warn("AgentPool: Error closing agent", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async enforceMaxSize(): Promise<void> {
    if (this.cache.size <= this.config.maxTotalAgents) {
      return;
    }

    // Sort by lastUsedAt (oldest first) for LRU eviction
    const entries = Array.from(this.cache.entries()).sort(
      ([, a], [, b]) => a.lastUsedAt - b.lastUsedAt
    );

    const toEvict = entries.slice(0, this.cache.size - this.config.maxTotalAgents);

    for (const [key] of toEvict) {
      await this.evictByKey(key);
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
