export type ThinkingSignatureRectifierTrigger =
  | "invalid_signature_in_thinking_block"
  | "invalid_request";

export type ThinkingSignatureRectifierResult = {
  applied: boolean;
  removedThinkingBlocks: number;
  removedRedactedThinkingBlocks: number;
  removedSignatureFields: number;
};

/**
 * 检测是否需要触发「thinking signature 整流器」
 *
 * 注意：这里不依赖错误规则开关（error rules 可能被用户关闭），仅做字符串/正则判断。
 */
export function detectThinkingSignatureRectifierTrigger(
  errorMessage: string | null | undefined
): ThinkingSignatureRectifierTrigger | null {
  if (!errorMessage) return null;

  const lower = errorMessage.toLowerCase();

  // 兼容带/不带反引号、不同大小写的变体
  const looksLikeInvalidSignatureInThinkingBlock =
    lower.includes("invalid") &&
    lower.includes("signature") &&
    lower.includes("thinking") &&
    lower.includes("block");

  if (looksLikeInvalidSignatureInThinkingBlock) {
    return "invalid_signature_in_thinking_block";
  }

  // 与默认错误规则保持一致（Issue #432 / Rule 6）
  if (/非法请求|illegal request|invalid request/i.test(errorMessage)) {
    return "invalid_request";
  }

  return null;
}

/**
 * 对 Anthropic 请求体做最小侵入整流：
 * - 移除 messages[*].content 中的 thinking/redacted_thinking block（避免签名不兼容触发 400）
 * - 移除非 thinking block 上遗留的 signature 字段（兼容跨渠道历史）
 *
 * 说明：
 * - 仅在上游报错后、同供应商重试前调用，避免影响正常请求。
 * - 该函数会原地修改 message 对象（更适合代理链路的性能要求）。
 */
export function rectifyAnthropicRequestMessage(
  message: Record<string, unknown>
): ThinkingSignatureRectifierResult {
  const messages = message.messages;
  if (!Array.isArray(messages)) {
    return {
      applied: false,
      removedThinkingBlocks: 0,
      removedRedactedThinkingBlocks: 0,
      removedSignatureFields: 0,
    };
  }

  let removedThinkingBlocks = 0;
  let removedRedactedThinkingBlocks = 0;
  let removedSignatureFields = 0;
  let applied = false;

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const msgObj = msg as Record<string, unknown>;
    const content = msgObj.content;
    if (!Array.isArray(content)) continue;

    const newContent: unknown[] = [];

    for (const block of content) {
      if (!block || typeof block !== "object") {
        newContent.push(block);
        continue;
      }

      const blockObj = block as Record<string, unknown>;
      const type = blockObj.type;

      if (type === "thinking") {
        removedThinkingBlocks += 1;
        applied = true;
        continue;
      }

      if (type === "redacted_thinking") {
        removedRedactedThinkingBlocks += 1;
        applied = true;
        continue;
      }

      if ("signature" in blockObj) {
        const { signature: _signature, ...rest } = blockObj as any;
        removedSignatureFields += 1;
        applied = true;
        newContent.push(rest);
        continue;
      }

      newContent.push(blockObj);
    }

    if (newContent.length !== content.length) {
      msgObj.content = newContent;
    } else if (removedSignatureFields > 0) {
      // 即使长度不变，只要移除了 signature，也需要落盘替换后的对象
      msgObj.content = newContent;
    }
  }

  return {
    applied,
    removedThinkingBlocks,
    removedRedactedThinkingBlocks,
    removedSignatureFields,
  };
}
