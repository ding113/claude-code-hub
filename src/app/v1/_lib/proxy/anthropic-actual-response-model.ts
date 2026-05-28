/**
 * Anthropic 流式响应"实际响应模型"解析(三态决策)
 *
 * 触发条件(同时满足):
 *   - providerType ∈ {claude, claude-auth}
 *   - requestedModel(重定向后)以 "claude-" 或 "anthropic/" 开头
 *
 * "Anthropic 类型供应商" 在 CCH 中语义实为 "Anthropic-compatible API";
 * GLM / Z.ai / DeepSeek 等第三方供应商也可能通过 Anthropic API 协议接入,
 * 但响应里没有 thinking signature。所以用"重定向后的请求模型族"判断真实
 * 上游是否是 Anthropic 模型族 —— claude-*(Anthropic 直连/中转)或
 * anthropic/*(部分聚合供应商命名前缀)。
 *
 * 命中触发后:
 *   1. 优先用 thinking signature 的 protobuf payload 解出模型名
 *      → source = "signature"(只校验长度,**不**限制必须含 "claude" —— 为
 *        未来模型家族变革留余地)
 *   2. 没拿到可用签名,但请求开启了思考 AND fallback 拿到 message_start 明文模型
 *      → source = "fallback_no_signature_with_thinking"
 *        (UI 在此 source 下展示"无思考签名"badge 作为异常告警)
 *   3. 其他情况(没开思考 / 没开签名 + 也没 message_start)
 *      → source = "fallback_no_thinking"(正常路径,无 badge)
 *
 * 未命中触发条件时返回 `source: null` / `actualResponseModel: null`,
 * 调用方应自己走 `extractActualResponseModelForProvider`(原始逻辑)。
 */

import { extractActualResponseModelForProvider } from "@/app/v1/_lib/proxy/actual-response-model";
import { extractThinkingSignatureModelFromStream } from "@/app/v1/_lib/proxy/thinking-signature-model";
import type { ProviderType } from "@/types/provider";

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
  /** 重定向后的实际请求模型(session.getCurrentModel()) */
  requestedModel: string | null;
  /** 由 isThinkingEnabled(session.request.message) 派生 */
  thinkingEnabled: boolean;
  /** 完整 SSE 流文本(allContent) */
  responseStreamText: string | null | undefined;
}

const ANTHROPIC_PROVIDER_TYPES: ReadonlySet<ProviderType> = new Set(["claude", "claude-auth"]);
const ANTHROPIC_MODEL_PREFIXES: readonly string[] = ["claude-", "anthropic/"];

/** DB `actual_response_model` 字段为 varchar(128),解码出的字符串必须落在该限制内。 */
const MAX_MODEL_NAME_LENGTH = 128;

export function resolveAnthropicStreamActualResponseModel(
  params: ResolveAnthropicStreamActualResponseModelParams
): AnthropicActualResponseModelResult {
  const { providerType, requestedModel, thinkingEnabled, responseStreamText } = params;

  if (!providerType || !ANTHROPIC_PROVIDER_TYPES.has(providerType)) {
    return { actualResponseModel: null, source: null };
  }
  if (!isAnthropicModelFamily(requestedModel)) {
    return { actualResponseModel: null, source: null };
  }

  const rawSignatureModel = extractThinkingSignatureModelFromStream(responseStreamText ?? "");
  if (isValidSignatureModel(rawSignatureModel)) {
    return { actualResponseModel: rawSignatureModel, source: "signature" };
  }

  // 没拿到可信签名:fallback 到 message_start 明文 model。通过 ForProvider 入口,
  // 保持 provider → kind 映射的唯一来源(actual-response-model.kindFromProviderType)。
  const fallbackModel = extractActualResponseModelForProvider(
    providerType,
    true,
    responseStreamText ?? ""
  );

  // 流被截断到没拿到 message_start 也没拿到签名 → 无法判断 "无签名" 是异常还是流根本没数据,
  // 一律归 fallback_no_thinking,不亮 badge,避免误告警。
  if (fallbackModel === null) {
    return { actualResponseModel: null, source: "fallback_no_thinking" };
  }

  return {
    actualResponseModel: fallbackModel,
    source: thinkingEnabled ? "fallback_no_signature_with_thinking" : "fallback_no_thinking",
  };
}

function isAnthropicModelFamily(model: string | null): boolean {
  if (!model) return false;
  return ANTHROPIC_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));
}

/**
 * 签名解出字符串合理性校验:必须非空 + 长度可入库(varchar 128)。
 * **不**限制必须含 "claude",避免在未来模型家族变革(如 Anthropic 改名 / 推
 * 新系列时)误拒合法值。校验由"触发条件已经守卫上游是 Anthropic 协议"兜底。
 */
function isValidSignatureModel(model: string | null): model is string {
  if (!model) return false;
  return model.length > 0 && model.length <= MAX_MODEL_NAME_LENGTH;
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
