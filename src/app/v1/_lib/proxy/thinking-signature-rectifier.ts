export type ThinkingSignatureRectifierTrigger =
  | "invalid_signature_in_thinking_block"
  | "assistant_message_must_start_with_thinking"
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

  // Claude 官方错误提示：thinking 启用时，工具调用链路中的最后一条 assistant 消息必须以 thinking 开头
  // 典型信息：
  // - Expected `thinking` or `redacted_thinking`, but found `tool_use`
  // - a final `assistant` message must start with a thinking block
  //
  // 该场景通常发生在工具调用回合中途“切换 thinking 模式”或遗失 thinking block 时，
  // 最安全的兜底是：在整流重试前关闭本次请求的顶层 thinking（避免继续触发 400）。
  const looksLikeThinkingEnabledButMissingThinkingPrefix =
    lower.includes("must start with a thinking block") ||
    /expected\s*`?thinking`?\s*or\s*`?redacted_thinking`?.*found\s*`?tool_use`?/i.test(
      errorMessage
    );

  if (looksLikeThinkingEnabledButMissingThinkingPrefix) {
    return "assistant_message_must_start_with_thinking";
  }

  // 兼容带/不带反引号、不同大小写的变体
  const looksLikeInvalidSignatureInThinkingBlock =
    lower.includes("invalid") &&
    lower.includes("signature") &&
    lower.includes("thinking") &&
    lower.includes("block");

  if (looksLikeInvalidSignatureInThinkingBlock) {
    return "invalid_signature_in_thinking_block";
  }

  // 检测：signature 字段缺失（Claude API 返回 "xxx.signature: Field required"）
  // 场景：请求体中存在 thinking block 但缺少 signature 字段
  // 常见于从非 Anthropic 渠道切换到 Anthropic 渠道时，历史 thinking block 未包含 signature
  const looksLikeMissingSignatureField =
    lower.includes("signature") && lower.includes("field required");

  if (looksLikeMissingSignatureField) {
    return "invalid_signature_in_thinking_block"; // 复用现有触发类型，整流逻辑相同
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
    let contentWasModified = false;

    for (const block of content) {
      if (!block || typeof block !== "object") {
        newContent.push(block);
        continue;
      }

      const blockObj = block as Record<string, unknown>;
      const type = blockObj.type;

      if (type === "thinking") {
        removedThinkingBlocks += 1;
        contentWasModified = true;
        continue;
      }

      if (type === "redacted_thinking") {
        removedRedactedThinkingBlocks += 1;
        contentWasModified = true;
        continue;
      }

      if ("signature" in blockObj) {
        const { signature: _signature, ...rest } = blockObj as any;
        removedSignatureFields += 1;
        contentWasModified = true;
        newContent.push(rest);
        continue;
      }

      newContent.push(blockObj);
    }

    if (contentWasModified) {
      applied = true;
      msgObj.content = newContent;
    }
  }

  // 兜底：thinking 启用 + 工具调用链路中最后一条 assistant 消息未以 thinking/redacted_thinking 开头
  // 该组合会触发 Anthropic 400（Expected thinking..., but found tool_use）。
  // 为避免继续失败，整流阶段直接删除顶层 thinking 字段（只影响本次重试）。
  const thinking = (message as Record<string, unknown>).thinking;
  const thinkingEnabled =
    thinking &&
    typeof thinking === "object" &&
    (thinking as Record<string, unknown>).type === "enabled";

  if (thinkingEnabled) {
    let lastAssistantContent: unknown[] | null = null;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || typeof msg !== "object") continue;
      const msgObj = msg as Record<string, unknown>;
      if (msgObj.role !== "assistant") continue;
      if (!Array.isArray(msgObj.content)) continue;
      lastAssistantContent = msgObj.content;
      break;
    }

    if (lastAssistantContent && lastAssistantContent.length > 0) {
      const firstBlock = lastAssistantContent[0];
      const firstBlockType =
        firstBlock && typeof firstBlock === "object"
          ? (firstBlock as Record<string, unknown>).type
          : null;

      const missingThinkingPrefix =
        firstBlockType !== "thinking" && firstBlockType !== "redacted_thinking";

      // 仅在缺少 thinking 前缀时才需要进一步检查是否存在 tool_use
      if (missingThinkingPrefix) {
        const hasToolUse = lastAssistantContent.some((block) => {
          if (!block || typeof block !== "object") return false;
          return (block as Record<string, unknown>).type === "tool_use";
        });

        if (hasToolUse) {
          delete (message as any).thinking;
          applied = true;
        }
      }
    }
  }

  return {
    applied,
    removedThinkingBlocks,
    removedRedactedThinkingBlocks,
    removedSignatureFields,
  };
}
