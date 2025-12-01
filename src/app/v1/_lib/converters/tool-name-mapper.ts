/**
 * 工具名称映射器
 *
 * 处理 Claude Messages API 的工具名称长度限制（最大 64 字符）。
 * 提供双向映射：original ↔ shortened
 *
 * 基于 CLIProxyAPI 的实现，参考：
 * - internal/translator/codex/claude/codex_claude_request.go
 * - internal/translator/codex/claude/codex_claude_response.go
 */

import { createHash } from "node:crypto";
import { logger } from "@/lib/logger";

/**
 * Claude 工具名称最大长度限制
 */
const CLAUDE_TOOL_NAME_MAX_LENGTH = 64;

/**
 * 哈希后缀长度（用于确保唯一性）
 */
const HASH_SUFFIX_LENGTH = 8;

/**
 * 工具名称映射器类
 *
 * 提供工具名称的缩短和恢复功能，维护双向映射关系。
 */
export class ToolNameMapper {
  /** 原始名称 → 缩短名称 */
  private originalToShort = new Map<string, string>();

  /** 缩短名称 → 原始名称 */
  private shortToOriginal = new Map<string, string>();

  /**
   * 从工具定义中构建映射
   *
   * @param tools - 工具定义数组（Claude format）
   */
  buildMapping(tools: Array<{ name: string; [key: string]: unknown }>): void {
    for (const tool of tools) {
      const originalName = tool.name;
      if (!originalName) {
        continue;
      }

      // 如果名称已在限制内，不需要缩短
      if (originalName.length <= CLAUDE_TOOL_NAME_MAX_LENGTH) {
        continue;
      }

      const shortenedName = this.shortenName(originalName);

      // 存储双向映射
      this.originalToShort.set(originalName, shortenedName);
      this.shortToOriginal.set(shortenedName, originalName);

      logger.debug(`[ToolNameMapper] Mapped tool name: ${originalName} → ${shortenedName}`);
    }
  }

  /**
   * 缩短工具名称（如果需要）
   *
   * 策略：
   * 1. 如果名称 <= 64 字符，直接返回
   * 2. 否则，截取前 N 字符 + "_" + 8字符哈希
   *
   * @param originalName - 原始名称
   * @returns 缩短后的名称
   */
  shortenName(originalName: string): string {
    if (originalName.length <= CLAUDE_TOOL_NAME_MAX_LENGTH) {
      return originalName;
    }

    // 计算哈希（用于确保唯一性）
    const hash = createHash("md5")
      .update(originalName)
      .digest("hex")
      .substring(0, HASH_SUFFIX_LENGTH);

    // 计算可用的前缀长度（总长度 - 下划线 - 哈希）
    const prefixLength = CLAUDE_TOOL_NAME_MAX_LENGTH - 1 - HASH_SUFFIX_LENGTH;

    // 截取前缀 + "_" + 哈希
    const shortened = `${originalName.substring(0, prefixLength)}_${hash}`;

    return shortened;
  }

  /**
   * 恢复原始工具名称
   *
   * @param shortenedName - 缩短后的名称
   * @returns 原始名称（如果找不到映射，返回缩短名称本身）
   */
  restoreName(shortenedName: string): string {
    const original = this.shortToOriginal.get(shortenedName);
    if (original) {
      logger.debug(`[ToolNameMapper] Restored tool name: ${shortenedName} → ${original}`);
      return original;
    }

    // 如果没有映射，说明名称没有被缩短过，直接返回
    return shortenedName;
  }

  /**
   * 获取缩短后的名称（如果有映射）
   *
   * @param originalName - 原始名称
   * @returns 缩短后的名称（如果找不到映射，返回原始名称本身）
   */
  getShortenedName(originalName: string): string {
    const shortened = this.originalToShort.get(originalName);
    if (shortened) {
      return shortened;
    }

    // 如果没有映射，检查是否需要缩短
    if (originalName.length > CLAUDE_TOOL_NAME_MAX_LENGTH) {
      return this.shortenName(originalName);
    }

    return originalName;
  }

  /**
   * 清空所有映射
   */
  clear(): void {
    this.originalToShort.clear();
    this.shortToOriginal.clear();
  }

  /**
   * 获取映射统计信息（调试用）
   */
  getStats(): {
    totalMappings: number;
    mappings: Array<{ original: string; shortened: string }>;
  } {
    const mappings: Array<{ original: string; shortened: string }> = [];

    this.originalToShort.forEach((shortened, original) => {
      mappings.push({ original, shortened });
    });

    return {
      totalMappings: mappings.length,
      mappings,
    };
  }
}

/**
 * 从请求中构建反向映射（缩短名称 → 原始名称）
 *
 * 用于响应转换时恢复原始工具名称。
 * 参考 CLIProxyAPI 的 buildReverseMapFromClaudeOriginalShortToOriginal 函数。
 *
 * @param request - 原始请求体（Claude format）
 * @returns 反向映射（缩短名称 → 原始名称）
 */
export function buildReverseMapFromRequest(request: Record<string, unknown>): Map<string, string> {
  const reverseMap = new Map<string, string>();

  // 从 tools 字段提取工具名称
  const tools = request.tools as Array<{ name: string; [key: string]: unknown }> | undefined;
  if (!tools || !Array.isArray(tools)) {
    return reverseMap;
  }

  const mapper = new ToolNameMapper();
  mapper.buildMapping(tools);

  // 构建反向映射
  const stats = mapper.getStats();
  for (const { original, shortened } of stats.mappings) {
    reverseMap.set(shortened, original);
  }

  return reverseMap;
}

/**
 * 从请求中构建正向映射（原始名称 → 缩短名称）
 *
 * 用于请求转换时缩短工具名称。
 * 参考 CLIProxyAPI 的 buildReverseMapFromClaudeOriginalToShort 函数。
 *
 * @param request - 原始请求体（Claude format）
 * @returns 正向映射（原始名称 → 缩短名称）
 */
export function buildForwardMapFromRequest(request: Record<string, unknown>): Map<string, string> {
  const forwardMap = new Map<string, string>();

  // 从 tools 字段提取工具名称
  const tools = request.tools as Array<{ name: string; [key: string]: unknown }> | undefined;
  if (!tools || !Array.isArray(tools)) {
    return forwardMap;
  }

  const mapper = new ToolNameMapper();
  mapper.buildMapping(tools);

  // 构建正向映射
  const stats = mapper.getStats();
  for (const { original, shortened } of stats.mappings) {
    forwardMap.set(original, shortened);
  }

  return forwardMap;
}
