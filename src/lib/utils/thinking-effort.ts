import { extractAnthropicEffortInfo } from "@/lib/utils/anthropic-effort";
import { extractCodexReasoningEffortInfo } from "@/lib/utils/codex-reasoning-effort";
import type { SpecialSetting } from "@/types/special-settings";

/** 思考强度审计来源：Codex 的 reasoning.effort 或 Anthropic 的 output_config.effort。 */
export type ThinkingEffortSource = "codex" | "anthropic";

/** 任意模型统一后的思考强度展示信息，供列表列与请求详情共用。 */
export interface ThinkingEffortInfo {
  source: ThinkingEffortSource;
  /** 客户端请求声明的思考强度；历史记录可能缺失。 */
  requestedEffort: string | null;
  /** 实际转发给上游的思考强度；供应商覆写移除该参数时为 null。 */
  effectiveEffort: string | null;
  isOverridden: boolean;
}

/**
 * 从 specialSettings 中提取任意模型的思考强度。
 *
 * 复用 Codex 与 Anthropic 两个提取器并统一返回结构：Codex 审计优先，
 * 其次回退到 Anthropic effort，两者都无则返回 null。
 */
export function extractThinkingEffortInfo(
  specialSettings: SpecialSetting[] | null | undefined
): ThinkingEffortInfo | null {
  const codexInfo = extractCodexReasoningEffortInfo(specialSettings);
  if (codexInfo) {
    return {
      source: "codex",
      requestedEffort: codexInfo.requestedEffort,
      effectiveEffort: codexInfo.effectiveEffort,
      isOverridden: codexInfo.isOverridden,
    };
  }

  const anthropicInfo = extractAnthropicEffortInfo(specialSettings);
  if (anthropicInfo) {
    return {
      source: "anthropic",
      requestedEffort: anthropicInfo.originalEffort,
      effectiveEffort: anthropicInfo.isOverridden
        ? anthropicInfo.overriddenEffort
        : anthropicInfo.originalEffort,
      isOverridden: anthropicInfo.isOverridden,
    };
  }

  return null;
}
