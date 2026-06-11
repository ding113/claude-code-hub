/**
 * Thinking Effort Conflict Rectifier - Reactive rectifier for strict Anthropic-compatible
 * providers (DeepSeek, MiMo, ...) that reject `thinking: { type: "disabled" }` combined
 * with a reasoning-effort field.
 *
 * Background (issue #1257): Claude Code v2.1.166+ disables thinking for subagent tasks
 * but keeps the global `output_config: { effort }` in the payload. The official Anthropic
 * API ignores the contradiction; DeepSeek's validation rejects it with
 * "thinking options type cannot be disabled when reasoning_effort is set" (DeepSeek docs:
 * `output_config` only supports `effort`, which maps to reasoning_effort internally).
 *
 * Action: strip the effort fields (`output_config.effort` carrier / top-level
 * `reasoning_effort`) while keeping thinking disabled, then retry the same provider once.
 */

export type ThinkingEffortConflictRectifierTrigger = "thinking_disabled_with_reasoning_effort";

export type ThinkingEffortConflictRectifierResult = {
  applied: boolean;
  removedOutputConfig: boolean;
  removedReasoningEffort: boolean;
  thinkingType: string | null;
  effort: string | null;
};

/**
 * 检测是否需要触发「thinking effort 冲突整流器」
 *
 * 注意：不依赖错误规则开关（error rules 可能被用户关闭），仅做字符串匹配。
 */
export function detectThinkingEffortConflictRectifierTrigger(
  errorMessage: string | null | undefined
): ThinkingEffortConflictRectifierTrigger | null {
  if (!errorMessage) return null;

  const lower = errorMessage.toLowerCase();

  const mentionsDisableConflict =
    lower.includes("cannot be disabled") || lower.includes("can not be disabled");
  if (!mentionsDisableConflict) return null;

  // DeepSeek 原文：thinking options type cannot be disabled when reasoning_effort is set
  if (lower.includes("reasoning_effort")) {
    return "thinking_disabled_with_reasoning_effort";
  }

  // 变体兜底：以 output_config(.effort) 表述同一冲突的上游
  if (lower.includes("output_config") && lower.includes("thinking")) {
    return "thinking_disabled_with_reasoning_effort";
  }

  return null;
}

/**
 * 对 Anthropic 请求体做最小侵入整流：
 * - 仅当 thinking 关闭（或缺省，上游按关闭处理）时生效
 * - 移除携带 effort 的 output_config 与顶层 reasoning_effort 透传字段
 * - 保留 thinking 关闭状态（尊重客户端对子 agent 关闭思考的意图）
 *
 * 说明：仅在上游报错后、同供应商重试前调用（被动触发），不影响正常请求；
 * 原地修改 message 对象。
 */
export function rectifyThinkingEffortConflict(
  message: Record<string, unknown>
): ThinkingEffortConflictRectifierResult {
  const thinking = message.thinking;
  const thinkingType =
    thinking && typeof thinking === "object" && !Array.isArray(thinking)
      ? typeof (thinking as Record<string, unknown>).type === "string"
        ? ((thinking as Record<string, unknown>).type as string)
        : null
      : null;

  const result: ThinkingEffortConflictRectifierResult = {
    applied: false,
    removedOutputConfig: false,
    removedReasoningEffort: false,
    thinkingType,
    effort: null,
  };

  // thinking 显式启用（enabled/adaptive 等）时不属于该冲突，保持原样
  const thinkingDisabled = thinkingType === null || thinkingType === "disabled";
  if (!thinkingDisabled) {
    return result;
  }

  const outputConfig = message.output_config;
  const outputConfigEffort =
    outputConfig && typeof outputConfig === "object" && !Array.isArray(outputConfig)
      ? (outputConfig as Record<string, unknown>).effort
      : undefined;

  if (outputConfigEffort !== undefined) {
    result.effort = typeof outputConfigEffort === "string" ? outputConfigEffort : null;
    // 仅剥离冲突的 effort 字段，保留 output_config 中的其他配置；若剥离后为空对象则整体移除。
    const { effort: _removedEffort, ...restOutputConfig } = outputConfig as Record<string, unknown>;
    if (Object.keys(restOutputConfig).length > 0) {
      message.output_config = restOutputConfig;
    } else {
      delete message.output_config;
    }
    result.removedOutputConfig = true;
    result.applied = true;
  }

  const reasoningEffort = message.reasoning_effort;
  if (reasoningEffort !== undefined) {
    if (result.effort === null && typeof reasoningEffort === "string") {
      result.effort = reasoningEffort;
    }
    delete message.reasoning_effort;
    result.removedReasoningEffort = true;
    result.applied = true;
  }

  return result;
}
