/**
 * Anthropic 流式响应"实际响应模型"解析(三态决策)
 *
 * 触发条件:
 *   - providerType ∈ {claude, claude-auth}
 *   - requestedModel 以 "claude-" 开头(大小写敏感)
 *
 * 命中触发后:
 *   1. 优先用 thinking signature 的 protobuf payload 解出模型名
 *      → source = "signature"
 *   2. 没拿到可用签名,但请求开启了思考(thinking.type ∈ {enabled, adaptive})
 *      → fallback 到 message_start 明文 model,source = "fallback_no_signature_with_thinking"
 *        (UI 在此 source 下展示"无思考签名"badge 作为异常告警)
 *   3. 没拿到签名且未开启思考
 *      → fallback,source = "fallback_no_thinking"(正常路径,无 badge)
 *
 * 未命中触发条件时返回 `source: null` / `actualResponseModel: null`,
 * 调用方应自己走 `extractActualResponseModelForProvider`(原始逻辑)。
 */

import type { ProviderType } from "@/types/provider";
import { extractActualResponseModel } from "./actual-response-model";
import { extractThinkingSignatureModelFromStream } from "./thinking-signature-model";

export type ResponseModelSource =
  | "signature"
  | "fallback_no_signature_with_thinking"
  | "fallback_no_thinking"
  | null;

export interface AnthropicActualResponseModelResult {
  actualResponseModel: string | null;
  source: ResponseModelSource;
}

export interface ResolveAnthropicStreamActualResponseModelParams {
  providerType: ProviderType | null | undefined;
  /** 重定向后的实际请求模型(session.getCurrentModel())*/
  requestedModel: string | null;
  /** 由 isThinkingEnabled(session.request.message) 派生 */
  thinkingEnabled: boolean;
  /** 完整 SSE 流文本(allContent) */
  responseStreamText: string | null | undefined;
}

const ANTHROPIC_PROVIDER_TYPES: ReadonlySet<ProviderType> = new Set(["claude", "claude-auth"]);
const CLAUDE_MODEL_PREFIX = "claude-";

export function resolveAnthropicStreamActualResponseModel(
  params: ResolveAnthropicStreamActualResponseModelParams
): AnthropicActualResponseModelResult {
  const { providerType, requestedModel, thinkingEnabled, responseStreamText } = params;

  if (!providerType || !ANTHROPIC_PROVIDER_TYPES.has(providerType)) {
    return { actualResponseModel: null, source: null };
  }
  if (!requestedModel?.startsWith(CLAUDE_MODEL_PREFIX)) {
    return { actualResponseModel: null, source: null };
  }

  const signatureModel = extractThinkingSignatureModelFromStream(responseStreamText ?? "");
  if (signatureModel) {
    return { actualResponseModel: signatureModel, source: "signature" };
  }

  // 没拿到签名:fallback 到 message_start 明文 model。
  // 复用 actual-response-model 的 anthropic/stream 提取器,避免重复实现 SSE 解析。
  const fallbackModel = extractActualResponseModel("anthropic/stream", responseStreamText ?? "");

  return {
    actualResponseModel: fallbackModel,
    source: thinkingEnabled ? "fallback_no_signature_with_thinking" : "fallback_no_thinking",
  };
}

/**
 * 判断请求 message 是否开启了思考。
 *
 * 约定:
 * - `message.thinking.type === "enabled"` → 显式开启
 * - `message.thinking.type === "adaptive"` → adaptive 也视为开启(参考 thinking-budget-rectifier)
 * - 其他(missing / null / 字符串 / 其他 type 字符串)→ 未开启
 */
export function isThinkingEnabled(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const thinking = (message as { thinking?: unknown }).thinking;
  if (!thinking || typeof thinking !== "object") return false;
  const type = (thinking as { type?: unknown }).type;
  return type === "enabled" || type === "adaptive";
}
