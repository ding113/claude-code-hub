import { extractAnthropicEffortFromRequestBody } from "@/lib/utils/anthropic-effort";
import { extractCodexReasoningEffortFromRequestBody } from "@/lib/utils/codex-reasoning-effort";
import { createMessageRequest } from "@/repository/message";
import type { ProxySession } from "./session";

/** 在供应商确定后创建请求使用记录，并补齐需要随记录持久化的请求审计。 */
export class ProxyMessageService {
  /**
   * 为当前代理请求创建持久化上下文。
   *
   * 思考强度必须在创建记录前写入 special_settings，后续供应商覆写审计才能与客户端
   * 原始值合并，准确展示实际转发给上游的等级。
   */
  static async ensureContext(session: ProxySession): Promise<void> {
    const authState = session.authState;
    const provider = session.provider;

    if (
      !authState?.success ||
      !authState.user ||
      !authState.key ||
      !authState.apiKey ||
      !provider
    ) {
      session.setMessageContext(null);
      return;
    }

    // Extract endpoint from URL pathname (nullable)
    const endpoint = session.getEndpoint() ?? undefined;

    // 修复模型重定向记录问题：
    // 由于 ensureContext 在模型重定向之前被调用（guard-pipeline 阶段），
    // 此时 session.getOriginalModel() 可能返回 null。
    // 因此需要在这里提前保存当前模型作为 original_model，
    // 如果后续发生重定向，ModelRedirector.apply() 会再次调用 setOriginalModel()（幂等性保护）
    const currentModel = session.request.model;
    if (currentModel && !session.getOriginalModel()) {
      session.setOriginalModel(currentModel);
    }

    const isAnthropicProvider =
      provider.providerType === "claude" || provider.providerType === "claude-auth";
    const hasAnthropicEffortAudit = session
      .getSpecialSettings()
      ?.some((setting) => setting.type === "anthropic_effort");

    if (isAnthropicProvider && !hasAnthropicEffortAudit) {
      const anthropicEffort = extractAnthropicEffortFromRequestBody(session.request.message);
      if (anthropicEffort) {
        session.addSpecialSetting({
          type: "anthropic_effort",
          scope: "request",
          hit: true,
          effort: anthropicEffort,
        });
      }
    }

    const hasCodexReasoningEffortAudit = session
      .getSpecialSettings()
      ?.some((setting) => setting.type === "codex_reasoning_effort");

    // Codex 客户端请求值先于供应商参数覆写入库，使用记录据此展示“请求值 -> 实际值”。
    if (provider.providerType === "codex" && !hasCodexReasoningEffortAudit) {
      const reasoningEffort = extractCodexReasoningEffortFromRequestBody(session.request.message);
      if (reasoningEffort) {
        session.addSpecialSetting({
          type: "codex_reasoning_effort",
          scope: "request",
          hit: true,
          effort: reasoningEffort,
        });
      }
    }

    const messageRequest = await createMessageRequest({
      provider_id: provider.id,
      user_id: authState.user.id,
      key: authState.apiKey,
      model: session.request.model ?? undefined,
      session_id: session.sessionId ?? undefined, // 传入 session_id
      request_sequence: session.getRequestSequence(), // 传入请求序号（Session 内）
      cost_multiplier: provider.costMultiplier, // 传入 cost_multiplier
      group_cost_multiplier: session.getGroupCostMultiplier(), // 传入分组倍率
      user_agent: session.userAgent ?? undefined, // 传入 user_agent
      client_ip: session.clientIp ?? undefined, // 客户端 IP（由统一 IP 提取中间件写入 session）
      original_model: session.getOriginalModel() ?? undefined, // 传入原始模型（用户请求的模型）
      messages_count: session.getMessagesLength(), // 传入 messages 数量
      endpoint, // 传入请求端点（可能为 undefined）
      special_settings: session.getSpecialSettings(), // 特殊设置（审计/展示）
    });

    session.setMessageContext({
      id: messageRequest.id,
      createdAt: messageRequest.createdAt,
      user: authState.user,
      key: authState.key,
      apiKey: authState.apiKey,
    });
  }
}
