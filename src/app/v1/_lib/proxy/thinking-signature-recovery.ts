import { ProxyError } from "./errors";

export type ThinkingSignatureSanitizeResult = {
  sanitized: Record<string, unknown>;
  changed: boolean;
  removedBlocks: number;
};

/**
 * 判断该错误是否与 thinking/signature 不兼容相关。
 *
 * 设计目标：
 * - 尽量只命中确定性高的错误（避免误处理其他 4xx/5xx）
 * - 覆盖两类典型报错：
 *   1) Invalid `signature` in `thinking` block
 *   2) `thinking` / `redacted_thinking` blocks ... cannot be modified
 */
export function isThinkingSignatureRelatedError(error: unknown): boolean {
  if (!(error instanceof ProxyError)) return false;
  if (error.statusCode < 400 || error.statusCode > 599) return false;

  const message = `${error.message || ""}\n${error.upstreamError?.body || ""}`.toLowerCase();

  // 错误格式不稳定：可能含 messages.{N}.content.{M}，也可能是 ***.***.content.{M}
  const hasContentIndex = message.includes("content.");

  const hasThinking = message.includes("thinking");
  const hasSignature = message.includes("signature");
  const cannotBeModified = message.includes("cannot be modified");
  const hasInvalid = message.includes("invalid");

  // 最强信号：直接出现 “Invalid signature in thinking block”
  const hasInvalidSignatureInThinkingBlock =
    message.includes("invalid `signature` in `thinking` block") ||
    message.includes("invalid signature in thinking block") ||
    (hasContentIndex && hasInvalid && hasSignature && hasThinking);

  // 其次：thinking/redacted_thinking blocks cannot be modified
  const hasThinkingCannotBeModified = hasThinking && cannotBeModified;

  return hasInvalidSignatureInThinkingBlock || hasThinkingCannotBeModified;
}

/**
 * 对 Claude Messages API 请求体进行最小降级：移除 thinking / redacted_thinking 内容块。
 *
 * 约束：
 * - 仅在 messages[].content 为数组时处理
 * - 不触碰 tool_use/tool_result 等会影响工具调用的块
 * - 若未发生任何移除，返回原对象引用（便于上游判断）
 */
export function sanitizeClaudeMessagesRequestThinkingBlocks(
  requestBody: Record<string, unknown>
): ThinkingSignatureSanitizeResult {
  const messages = requestBody.messages;

  if (!Array.isArray(messages)) {
    return { sanitized: requestBody, changed: false, removedBlocks: 0 };
  }

  let removedBlocks = 0;
  let changed = false;

  const sanitizedMessages = messages.map((msg) => {
    if (!msg || typeof msg !== "object") return msg;
    const msgObj = msg as Record<string, unknown>;
    const content = msgObj.content;

    if (!Array.isArray(content)) {
      return msg;
    }

    const filteredContent = content.filter((block) => {
      if (!block || typeof block !== "object") return true;
      const blockType = (block as Record<string, unknown>).type;
      if (blockType === "thinking" || blockType === "redacted_thinking") {
        removedBlocks += 1;
        changed = true;
        return false;
      }
      return true;
    });

    // 若本条消息没有变化，保持原引用，避免无意义的对象 churn
    if (filteredContent.length === content.length) {
      return msg;
    }

    return { ...msgObj, content: filteredContent };
  });

  if (!changed) {
    return { sanitized: requestBody, changed: false, removedBlocks: 0 };
  }

  return {
    sanitized: { ...requestBody, messages: sanitizedMessages },
    changed: true,
    removedBlocks,
  };
}
