/**
 * 关键词路由规则缓存引擎
 *
 * 特性：
 * - 内存缓存全部启用规则（priority 升序、id 升序，与匹配器评估顺序一致）
 * - 单例模式，全局复用
 * - 支持热重载（本地 eventEmitter + Redis pub/sub）
 *
 * 注意：与敏感词引擎保持一致，构造时不主动加载规则，
 * 由 route.ts 模块初始化阶段统一预热（warmup）
 */

import {
  findMatchingKeywordRoutingRule,
  type KeywordRoutingMatch,
} from "@/lib/keyword-routing/matcher";
import { logger } from "@/lib/logger";
import type { KeywordRoutingScanTexts } from "@/lib/message-extractor";
import {
  getActiveKeywordRoutingRules,
  type KeywordRoutingRule,
} from "@/repository/keyword-routing-rules";

class KeywordRoutingRuleCache {
  private rules: KeywordRoutingRule[] = [];
  private lastReloadTime = 0;
  private isLoading = false;

  private eventEmitterCleanup: (() => void) | null = null;
  private redisPubSubCleanup: (() => void) | null = null;

  constructor() {
    this.setupEventListener();
  }

  private async setupEventListener(): Promise<void> {
    if (typeof process !== "undefined" && process.env.NEXT_RUNTIME !== "edge") {
      try {
        const { eventEmitter } = await import("@/lib/event-emitter");
        const handler = () => {
          logger.info("[KeywordRoutingRuleCache] Received update event, reloading...");
          void this.reload();
        };
        eventEmitter.on("keywordRoutingRulesUpdated", handler);
        logger.info("[KeywordRoutingRuleCache] Subscribed to local eventEmitter");

        this.eventEmitterCleanup = () => {
          eventEmitter.off("keywordRoutingRulesUpdated", handler);
        };

        try {
          const { CHANNEL_KEYWORD_ROUTING_RULES_UPDATED, subscribeCacheInvalidation } =
            await import("@/lib/redis/pubsub");
          const cleanup = await subscribeCacheInvalidation(
            CHANNEL_KEYWORD_ROUTING_RULES_UPDATED,
            handler
          );
          if (cleanup) {
            this.redisPubSubCleanup = cleanup;
            logger.info("[KeywordRoutingRuleCache] Subscribed to Redis pub/sub channel");
          }
        } catch (error) {
          logger.warn("[KeywordRoutingRuleCache] Failed to subscribe to Redis pub/sub", { error });
        }
      } catch (error) {
        logger.warn("[KeywordRoutingRuleCache] Failed to setup event listener", { error });
      }
    }
  }

  destroy(): void {
    this.eventEmitterCleanup?.();
    this.eventEmitterCleanup = null;

    this.redisPubSubCleanup?.();
    this.redisPubSubCleanup = null;
  }

  /**
   * 从数据库重新加载关键词路由规则
   */
  async reload(): Promise<void> {
    if (this.isLoading) {
      logger.warn("[KeywordRoutingRuleCache] Reload already in progress, skipping");
      return;
    }

    this.isLoading = true;

    try {
      logger.info("[KeywordRoutingRuleCache] Reloading keyword routing rules from database...");

      const rules = await getActiveKeywordRoutingRules();

      this.rules = rules;
      this.lastReloadTime = Date.now();

      logger.info(`[KeywordRoutingRuleCache] Loaded ${rules.length} keyword routing rules`);
    } catch (error) {
      logger.error("[KeywordRoutingRuleCache] Failed to reload keyword routing rules:", error);
      // 失败时不清空现有缓存，保持降级可用
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * 在扫描文本中查找首个命中的关键词路由规则
   *
   * @param texts - 按来源分类的待扫描文本
   * @param requestedModel - 客户端请求的模型名（可能为 null）
   * @returns 首个命中的规则及命中位置，未命中返回 null
   */
  match(texts: KeywordRoutingScanTexts, requestedModel: string | null): KeywordRoutingMatch | null {
    return findMatchingKeywordRoutingRule(this.rules, texts, requestedModel);
  }

  /**
   * 检查缓存是否为空
   */
  isEmpty(): boolean {
    return this.rules.length === 0;
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    return {
      ruleCount: this.rules.length,
      lastReloadTime: this.lastReloadTime,
      isLoading: this.isLoading,
    };
  }
}

// Use globalThis to guarantee a single instance across workers
const g = globalThis as unknown as { __CCH_KEYWORD_ROUTING_ENGINE__?: KeywordRoutingRuleCache };
if (!g.__CCH_KEYWORD_ROUTING_ENGINE__) {
  g.__CCH_KEYWORD_ROUTING_ENGINE__ = new KeywordRoutingRuleCache();
}
export const keywordRoutingEngine = g.__CCH_KEYWORD_ROUTING_ENGINE__;
