/**
 * 错误规则检测引擎
 *
 * 特性：
 * - 按规则类型分组缓存（regex/contains/exact）
 * - 性能优先的检测顺序（包含 → 精确 → 正则）
 * - 单例模式，全局复用
 * - 支持热重载
 * - ReDoS 风险检测（safe-regex）
 * - EventEmitter 驱动的自动缓存刷新
 * - 数据库异常保护：失败时不抛异常，下次检测时重试
 */

import safeRegex from "safe-regex";
import { isValidErrorOverrideResponse } from "@/lib/error-override-validator";
import { logger } from "@/lib/logger";
import { type ErrorOverrideResponse, getActiveErrorRules } from "@/repository/error-rules";

/**
 * 错误检测结果
 */
export interface ErrorDetectionResult {
  matched: boolean;
  category?: string; // 触发的错误分类
  pattern?: string; // 匹配的规则模式
  matchType?: string; // 匹配类型（regex/contains/exact）
  /** 覆写响应体：如果配置了则用此响应替换原始错误响应 */
  overrideResponse?: ErrorOverrideResponse;
  /** 覆写状态码：如果配置了则用此状态码替换原始状态码 */
  overrideStatusCode?: number;
}

/**
 * 缓存的正则规则
 */
interface RegexPattern {
  pattern: RegExp;
  category: string;
  description?: string;
  overrideResponse?: ErrorOverrideResponse;
  overrideStatusCode?: number;
}

/**
 * 缓存的包含规则
 */
interface ContainsPattern {
  text: string;
  category: string;
  description?: string;
  overrideResponse?: ErrorOverrideResponse;
  overrideStatusCode?: number;
}

/**
 * 缓存的精确规则
 */
interface ExactPattern {
  text: string;
  category: string;
  description?: string;
  overrideResponse?: ErrorOverrideResponse;
  overrideStatusCode?: number;
}

/**
 * 错误规则检测缓存类
 */
class ErrorRuleDetector {
  private regexPatterns: RegexPattern[] = [];
  private containsPatterns: ContainsPattern[] = [];
  private exactPatterns: Map<string, ExactPattern> = new Map();
  private lastReloadTime: number = 0;
  private isLoading: boolean = false;
  private isInitialized: boolean = false; // 跟踪初始化状态
  private initializationPromise: Promise<void> | null = null; // 防止并发初始化竞态
  private dbLoadedSuccessfully: boolean = false; // 是否成功从数据库加载过

  constructor() {
    // 延迟初始化事件监听（仅在 Node.js runtime 中）
    this.setupEventListener();
  }

  /**
   * 设置事件监听器（仅在 Node.js runtime）
   */
  private async setupEventListener(): Promise<void> {
    // 仅在 Node.js runtime 中设置事件监听
    if (typeof process !== "undefined" && process.env.NEXT_RUNTIME !== "edge") {
      try {
        const { eventEmitter } = await import("@/lib/event-emitter");
        eventEmitter.on("errorRulesUpdated", () => {
          // 重置标记，强制下次从数据库重新加载
          this.dbLoadedSuccessfully = false;
          this.isInitialized = false;
          this.reload().catch((error) => {
            logger.error("[ErrorRuleDetector] Failed to reload cache on event:", error);
          });
        });
      } catch {
        // 忽略导入错误（可能在 Edge runtime 中）
      }
    }
  }

  /**
   * 确保规则已加载（懒加载，首次使用时或显式 reload 时调用）
   * 避免在数据库未准备好时过早加载
   * 使用 Promise 合并模式防止并发请求时的竞态条件
   *
   * 重要：如果从未成功从数据库加载过，每次调用都会尝试重新加载
   * 一旦成功加载，后续调用将跳过加载（直到重启/事件触发）
   *
   * 公开此方法供外部调用（如 Server Actions），确保在读取缓存统计等
   * 操作前缓存已初始化，解决新 worker 进程中缓存为空的问题
   */
  async ensureInitialized(): Promise<void> {
    // 只有成功从数据库加载过，才跳过初始化
    if (this.dbLoadedSuccessfully && this.isInitialized) {
      return;
    }

    if (!this.initializationPromise) {
      this.initializationPromise = this.reload().finally(() => {
        this.initializationPromise = null;
      });
    }

    await this.initializationPromise;
  }

  /**
   * 从数据库重新加载错误规则
   *
   * 数据库异常保护策略：
   * - 失败时不抛出异常，只记录错误日志
   * - 保留现有缓存（如果有），下次检测时重试加载
   * - 成功加载后标记 dbLoadedSuccessfully，后续不再重试
   */
  async reload(): Promise<void> {
    if (this.isLoading) {
      logger.warn("[ErrorRuleDetector] Reload already in progress, skipping");
      return;
    }

    this.isLoading = true;

    try {
      logger.info("[ErrorRuleDetector] Reloading error rules from database...");

      let rules;
      try {
        rules = await getActiveErrorRules();
        this.dbLoadedSuccessfully = true;
      } catch (dbError) {
        const errorMessage = (dbError as Error).message || "";

        // 记录数据库错误（区分表不存在和其他错误）
        if (errorMessage.includes("relation") && errorMessage.includes("does not exist")) {
          logger.warn(
            "[ErrorRuleDetector] error_rules table does not exist yet (migration pending)"
          );
        } else {
          logger.error("[ErrorRuleDetector] Database error while loading error rules:", dbError);
        }

        // 保留现有缓存，下次检测时重试
        this.lastReloadTime = Date.now();
        return;
      }

      // 使用局部变量收集新数据，避免 reload 期间 detect() 返回空结果
      const newRegexPatterns: RegexPattern[] = [];
      const newContainsPatterns: ContainsPattern[] = [];
      const newExactPatterns = new Map<string, ExactPattern>();

      // 按类型分组加载规则
      let validRegexCount = 0;
      let skippedRedosCount = 0;
      let skippedInvalidResponseCount = 0;

      for (const rule of rules) {
        // 在加载阶段验证 overrideResponse 格式，过滤畸形数据
        let validatedOverrideResponse: ErrorOverrideResponse | undefined;
        if (rule.overrideResponse) {
          if (isValidErrorOverrideResponse(rule.overrideResponse)) {
            validatedOverrideResponse = rule.overrideResponse;
          } else {
            logger.warn(
              `[ErrorRuleDetector] Invalid override_response for rule ${rule.id} (pattern: ${rule.pattern}), skipping response override`
            );
            skippedInvalidResponseCount++;
          }
        }

        switch (rule.matchType) {
          case "contains": {
            const lowerText = rule.pattern.toLowerCase();
            newContainsPatterns.push({
              text: lowerText,
              category: rule.category,
              description: rule.description ?? undefined,
              overrideResponse: validatedOverrideResponse,
              overrideStatusCode: rule.overrideStatusCode ?? undefined,
            });
            break;
          }

          case "exact": {
            const lowerText = rule.pattern.toLowerCase();
            newExactPatterns.set(lowerText, {
              text: lowerText,
              category: rule.category,
              description: rule.description ?? undefined,
              overrideResponse: validatedOverrideResponse,
              overrideStatusCode: rule.overrideStatusCode ?? undefined,
            });
            break;
          }

          case "regex": {
            // 使用 safe-regex 检测 ReDoS 风险
            try {
              if (!safeRegex(rule.pattern)) {
                logger.warn(
                  `[ErrorRuleDetector] ReDoS risk detected in pattern: ${rule.pattern}, skipping`
                );
                skippedRedosCount++;
                break;
              }

              const pattern = new RegExp(rule.pattern, "i");
              newRegexPatterns.push({
                pattern,
                category: rule.category,
                description: rule.description ?? undefined,
                overrideResponse: validatedOverrideResponse,
                overrideStatusCode: rule.overrideStatusCode ?? undefined,
              });
              validRegexCount++;
            } catch (error) {
              logger.error(`[ErrorRuleDetector] Invalid regex pattern: ${rule.pattern}`, error);
            }
            break;
          }

          default:
            logger.warn(`[ErrorRuleDetector] Unknown match type: ${rule.matchType}`);
        }
      }

      // 原子替换：确保 detect() 始终看到一致的数据集
      this.regexPatterns = newRegexPatterns;
      this.containsPatterns = newContainsPatterns;
      this.exactPatterns = newExactPatterns;

      this.lastReloadTime = Date.now();
      this.isInitialized = true; // 标记为已初始化

      const skippedInfo = [
        skippedRedosCount > 0 ? `${skippedRedosCount} ReDoS` : "",
        skippedInvalidResponseCount > 0 ? `${skippedInvalidResponseCount} invalid response` : "",
      ]
        .filter(Boolean)
        .join(", ");

      logger.info(
        `[ErrorRuleDetector] Loaded ${rules.length} error rules: ` +
          `contains=${newContainsPatterns.length}, exact=${newExactPatterns.size}, ` +
          `regex=${validRegexCount}${skippedInfo ? ` (skipped: ${skippedInfo})` : ""}`
      );
    } catch (error) {
      logger.error("[ErrorRuleDetector] Failed to reload error rules:", error);
      // 失败时不清空现有缓存，保持降级可用
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * 异步检测错误消息（推荐使用）
   * 确保规则已加载后再进行检测
   *
   * @param errorMessage - 错误消息
   * @returns 检测结果
   */
  async detectAsync(errorMessage: string): Promise<ErrorDetectionResult> {
    await this.ensureInitialized();
    return this.detect(errorMessage);
  }

  /**
   * 检测错误消息是否匹配任何规则（同步版本）
   *
   * 注意：如果规则未初始化，会记录警告并返回 false
   * 推荐使用 detectAsync() 以确保规则已加载
   *
   * 检测顺序（性能优先）：
   * 1. 包含匹配（最快，O(n*m)）
   * 2. 精确匹配（使用 Set，O(1)）
   * 3. 正则匹配（最慢，但最灵活）
   *
   * @param errorMessage - 错误消息
   * @returns 检测结果
   */
  detect(errorMessage: string): ErrorDetectionResult {
    if (!errorMessage || errorMessage.length === 0) {
      return { matched: false };
    }

    // 如果未初始化，记录警告
    if (!this.isInitialized && !this.isLoading) {
      logger.warn(
        "[ErrorRuleDetector] detect() called before initialization, results may be incomplete. Consider using detectAsync() instead."
      );
    }

    const lowerMessage = errorMessage.toLowerCase();
    const trimmedMessage = lowerMessage.trim();

    // 1. 包含匹配（最快）
    for (const pattern of this.containsPatterns) {
      if (lowerMessage.includes(pattern.text)) {
        return {
          matched: true,
          category: pattern.category,
          pattern: pattern.text,
          matchType: "contains",
          overrideResponse: pattern.overrideResponse,
          overrideStatusCode: pattern.overrideStatusCode,
        };
      }
    }

    // 2. 精确匹配（O(1) 查询）
    const exactMatch = this.exactPatterns.get(trimmedMessage);
    if (exactMatch) {
      return {
        matched: true,
        category: exactMatch.category,
        pattern: exactMatch.text,
        matchType: "exact",
        overrideResponse: exactMatch.overrideResponse,
        overrideStatusCode: exactMatch.overrideStatusCode,
      };
    }

    // 3. 正则匹配（最慢，但最灵活）
    for (const { pattern, category, overrideResponse, overrideStatusCode } of this.regexPatterns) {
      if (pattern.test(errorMessage)) {
        return {
          matched: true,
          category,
          pattern: pattern.source,
          matchType: "regex",
          overrideResponse,
          overrideStatusCode,
        };
      }
    }

    return { matched: false };
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    return {
      regexCount: this.regexPatterns.length,
      containsCount: this.containsPatterns.length,
      exactCount: this.exactPatterns.size,
      totalCount:
        this.regexPatterns.length + this.containsPatterns.length + this.exactPatterns.size,
      lastReloadTime: this.lastReloadTime,
      isLoading: this.isLoading,
    };
  }

  /**
   * 检查是否完成至少一次初始化
   *
   * 用于避免未加载完成时缓存空结果，导致后续请求无法命中规则
   */
  hasInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * 检查缓存是否为空
   */
  isEmpty(): boolean {
    return (
      this.regexPatterns.length === 0 &&
      this.containsPatterns.length === 0 &&
      this.exactPatterns.size === 0
    );
  }
}

/**
 * 全局单例导出
 */
export const errorRuleDetector = new ErrorRuleDetector();
