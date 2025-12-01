/**
 * 敏感词检测引擎
 *
 * 特性：
 * - 按匹配类型分组缓存（contains/exact/regex）
 * - 性能优先的检测顺序（包含 → 精确 → 正则）
 * - 单例模式，全局复用
 * - 支持热重载
 */

import { logger } from "@/lib/logger";
import { getActiveSensitiveWords } from "@/repository/sensitive-words";

export interface DetectionResult {
  matched: boolean;
  word?: string; // 触发的敏感词
  matchType?: string; // 匹配类型
  matchedText?: string; // 实际匹配到的文本片段
}

interface RegexPattern {
  pattern: RegExp;
  word: string;
}

class SensitiveWordCache {
  private contains: string[] = [];
  private exact: Set<string> = new Set();
  private regex: RegexPattern[] = [];
  private lastReloadTime: number = 0;
  private isLoading: boolean = false;

  /**
   * 从数据库重新加载敏感词列表
   */
  async reload(): Promise<void> {
    if (this.isLoading) {
      logger.warn("[SensitiveWordCache] Reload already in progress, skipping");
      return;
    }

    this.isLoading = true;

    try {
      logger.info("[SensitiveWordCache] Reloading sensitive words from database...");

      const words = await getActiveSensitiveWords();

      // 清空旧缓存
      this.contains = [];
      this.exact.clear();
      this.regex = [];

      // 按类型分组
      for (const word of words) {
        const lowerWord = word.word.toLowerCase();

        switch (word.matchType) {
          case "contains":
            this.contains.push(lowerWord);
            break;

          case "exact":
            this.exact.add(lowerWord);
            break;

          case "regex":
            try {
              const pattern = new RegExp(word.word, "i");
              this.regex.push({ pattern, word: word.word });
            } catch (error) {
              logger.error(`[SensitiveWordCache] Invalid regex pattern: ${word.word}`, error);
            }
            break;

          default:
            logger.warn(`[SensitiveWordCache] Unknown match type: ${word.matchType}`);
        }
      }

      this.lastReloadTime = Date.now();

      logger.info(
        `[SensitiveWordCache] Loaded ${words.length} sensitive words: ` +
          `contains=${this.contains.length}, exact=${this.exact.size}, regex=${this.regex.length}`
      );
    } catch (error) {
      logger.error("[SensitiveWordCache] Failed to reload sensitive words:", error);
      // 失败时不清空现有缓存，保持降级可用
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * 检测文本中是否包含敏感词
   *
   * @param text - 需要检测的文本
   * @returns 检测结果
   */
  detect(text: string): DetectionResult {
    if (!text || text.length === 0) {
      return { matched: false };
    }

    const lowerText = text.toLowerCase();
    const trimmedText = lowerText.trim();

    // 1. 包含匹配（最快，O(n*m)）
    for (const word of this.contains) {
      if (lowerText.includes(word)) {
        return {
          matched: true,
          word,
          matchType: "contains",
          matchedText: this.extractMatchedText(text, word),
        };
      }
    }

    // 2. 精确匹配（使用 Set，O(1)）
    if (this.exact.has(trimmedText)) {
      return {
        matched: true,
        word: trimmedText,
        matchType: "exact",
        matchedText: text.trim(),
      };
    }

    // 3. 正则匹配（最慢，但最灵活）
    for (const { pattern, word } of this.regex) {
      const match = pattern.exec(text);
      if (match) {
        return {
          matched: true,
          word,
          matchType: "regex",
          matchedText: match[0],
        };
      }
    }

    return { matched: false };
  }

  /**
   * 提取匹配到的文本片段（带上下文）
   */
  private extractMatchedText(text: string, word: string): string {
    const lowerText = text.toLowerCase();
    const index = lowerText.indexOf(word.toLowerCase());

    if (index === -1) {
      return text.substring(0, 50); // 降级：返回前50字符
    }

    // 提取前后各20个字符作为上下文
    const start = Math.max(0, index - 20);
    const end = Math.min(text.length, index + word.length + 20);
    const snippet = text.substring(start, end);

    return start > 0 ? `...${snippet}` : snippet;
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    return {
      containsCount: this.contains.length,
      exactCount: this.exact.size,
      regexCount: this.regex.length,
      totalCount: this.contains.length + this.exact.size + this.regex.length,
      lastReloadTime: this.lastReloadTime,
      isLoading: this.isLoading,
    };
  }

  /**
   * 检查缓存是否为空
   */
  isEmpty(): boolean {
    return this.contains.length === 0 && this.exact.size === 0 && this.regex.length === 0;
  }
}

// 单例导出
export const sensitiveWordDetector = new SensitiveWordCache();
