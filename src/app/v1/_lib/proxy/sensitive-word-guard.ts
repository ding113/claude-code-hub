/**
 * 敏感词守卫
 *
 * 职责：
 * - 检测请求中是否包含敏感词
 * - 记录被拦截的请求到数据库（不计费）
 * - 返回详细的拦截信息给用户
 *
 * 调用时机：
 * - 认证成功后
 * - Session 分配后
 * - 限流检查前
 * - 计费之前（重要！）
 */

import { db } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import { extractTextFromMessages } from "@/lib/message-extractor";
import { sensitiveWordDetector } from "@/lib/sensitive-word-detector";
import { ProxyResponses } from "./responses";
import type { ProxySession } from "./session";

export class ProxySensitiveWordGuard {
  /**
   * 检查请求是否包含敏感词
   *
   * @returns 如果包含敏感词，返回 Response；否则返回 null（放行）
   */
  static async ensure(session: ProxySession): Promise<Response | null> {
    try {
      // 快速路径：如果缓存为空，直接放行
      if (sensitiveWordDetector.isEmpty()) {
        return null;
      }

      // 提取所有需要检测的文本
      const texts = extractTextFromMessages(session.request.message);

      if (texts.length === 0) {
        return null; // 无文本内容，放行
      }

      // 检测敏感词
      for (const text of texts) {
        const result = sensitiveWordDetector.detect(text);

        if (result.matched) {
          // 记录到日志
          logger.warn("[SensitiveWordGuard] Blocked request", {
            userId: session.authState?.user?.id,
            userName: session.authState?.user?.name,
            keyId: session.authState?.key?.id,
            sessionId: session.sessionId,
            word: result.word,
            matchType: result.matchType,
            matchedText: result.matchedText,
          });

          // 记录到数据库（异步，不阻塞响应）
          void ProxySensitiveWordGuard.logBlockedRequest(session, result);

          // 构造详细的错误信息
          const errorMessage = ProxySensitiveWordGuard.buildErrorMessage(result);

          return ProxyResponses.buildError(400, errorMessage);
        }
      }

      return null; // 通过检测，放行
    } catch (error) {
      logger.error("[SensitiveWordGuard] Detection error:", error);
      return null; // 降级：检测失败时放行，不阻塞正常请求
    }
  }

  /**
   * 记录被拦截的请求到数据库
   */
  private static async logBlockedRequest(
    session: ProxySession,
    result: { word?: string; matchType?: string; matchedText?: string }
  ): Promise<void> {
    try {
      if (!session.authState?.user || !session.authState?.key || !session.authState?.apiKey) {
        logger.warn("[SensitiveWordGuard] Cannot log blocked request: missing auth state");
        return;
      }

      // 使用 provider_id = 0 表示被拦截的请求（未选择 provider）
      await db.insert(messageRequest).values({
        providerId: 0, // 特殊值：表示被拦截
        userId: session.authState.user.id,
        key: session.authState.apiKey,
        model: session.request.model ?? undefined,
        sessionId: session.sessionId ?? undefined,
        statusCode: 400,
        costUsd: "0", // 不计费
        blockedBy: "sensitive_word",
        blockedReason: JSON.stringify({
          word: result.word,
          matchType: result.matchType,
          matchedText: result.matchedText,
        }),
        errorMessage: `请求包含敏感词："${result.word}"`,
      });

      logger.info("[SensitiveWordGuard] Blocked request logged to database", {
        userId: session.authState.user.id,
        word: result.word,
      });
    } catch (error) {
      logger.error("[SensitiveWordGuard] Failed to log blocked request:", error);
      // 失败不影响拦截行为
    }
  }

  /**
   * 构造详细的错误信息
   */
  private static buildErrorMessage(result: {
    word?: string;
    matchType?: string;
    matchedText?: string;
  }): string {
    const parts: string[] = [];

    parts.push(`请求包含敏感词："${result.word}"`);

    if (result.matchedText && result.matchedText !== result.word) {
      parts.push(`匹配内容："${result.matchedText}"`);
    }

    if (result.matchType) {
      const typeLabels: Record<string, string> = {
        contains: "包含匹配",
        exact: "精确匹配",
        regex: "正则匹配",
      };
      const typeLabel = typeLabels[result.matchType] || result.matchType;
      parts.push(`匹配类型：${typeLabel}`);
    }

    parts.push("请修改后重试。");

    return parts.join("，");
  }
}
