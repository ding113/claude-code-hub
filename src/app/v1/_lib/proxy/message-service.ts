import { createMessageRequest } from "@/repository/message";
import type { ProxySession } from "./session";

export class ProxyMessageService {
  static async ensureContext(session: ProxySession): Promise<void> {
    const authState = session.authState;
    const provider = session.provider;

    if (
      !authState ||
      !authState.success ||
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

    // ⭐ 修复模型重定向记录问题：
    // 由于 ensureContext 在模型重定向之前被调用（guard-pipeline 阶段），
    // 此时 session.getOriginalModel() 可能返回 null。
    // 因此需要在这里提前保存当前模型作为 original_model，
    // 如果后续发生重定向，ModelRedirector.apply() 会再次调用 setOriginalModel()（幂等性保护）
    const currentModel = session.request.model;
    if (currentModel && !session.getOriginalModel()) {
      session.setOriginalModel(currentModel);
    }

    const messageRequest = await createMessageRequest({
      provider_id: provider.id,
      user_id: authState.user.id,
      key: authState.apiKey,
      model: session.request.model ?? undefined,
      session_id: session.sessionId ?? undefined, // 传入 session_id
      request_sequence: session.getRequestSequence(), // 传入请求序号（Session 内）
      cost_multiplier: provider.costMultiplier, // 传入 cost_multiplier
      user_agent: session.userAgent ?? undefined, // 传入 user_agent
      original_model: session.getOriginalModel() ?? undefined, // 传入原始模型（用户请求的模型）
      messages_count: session.getMessagesLength(), // 传入 messages 数量
      endpoint, // 传入请求端点（可能为 undefined）
    });

    session.setMessageContext({
      id: messageRequest.id,
      user: authState.user,
      key: authState.key,
      apiKey: authState.apiKey,
    });
  }
}
