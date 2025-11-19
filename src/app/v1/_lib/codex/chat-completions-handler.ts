/**
 * OpenAI Compatible API Handler (/v1/chat/completions)
 *
 * 致谢：本文件中的 OpenAI 兼容层实现参考了以下开源项目：
 * - https://github.com/router-for-me/CLIProxyAPI (MIT License)
 * 感谢原作者的优秀工作和开源贡献！
 */

import type { Context } from "hono";
import { logger } from "@/lib/logger";
import { ProxySession } from "../proxy/session";
import { ProxyAuthenticator } from "../proxy/auth-guard";
import { ProxySessionGuard } from "../proxy/session-guard";
import { ProxySensitiveWordGuard } from "../proxy/sensitive-word-guard";
import { ProxyRateLimitGuard } from "../proxy/rate-limit-guard";
import { ProxyProviderResolver } from "../proxy/provider-selector";
import { ProxyMessageService } from "../proxy/message-service";
import { ProxyForwarder } from "../proxy/forwarder";
import { ProxyResponseHandler } from "../proxy/response-handler";
import { ProxyErrorHandler } from "../proxy/error-handler";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";
import type { ChatCompletionRequest } from "./types/compatible";

/**
 * 处理 OpenAI Compatible API 请求 (/v1/chat/completions)
 *
 * 工作流程：
 * 1. 解析 OpenAI 格式请求
 * 2. 转换为 Response API 格式
 * 3. 注入 Codex CLI instructions (如果需要)
 * 4. 复用现有代理流程
 * 5. 响应自动转换回 OpenAI 格式（在 ResponseHandler 中）
 */
export async function handleChatCompletions(c: Context): Promise<Response> {
  logger.info("[ChatCompletions] Received OpenAI Compatible API request");

  const session = await ProxySession.fromContext(c);

  try {
    const request = session.request.message;

    // 格式检测
    const isOpenAIFormat = "messages" in request && Array.isArray(request.messages);
    const isResponseAPIFormat = "input" in request && Array.isArray(request.input);

    if (!isOpenAIFormat && !isResponseAPIFormat) {
      return new Response(
        JSON.stringify({
          error: {
            message:
              'Invalid request: either "messages" (OpenAI format) or "input" (Response API format) is required',
            type: "invalid_request_error",
            code: "missing_required_fields",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (isOpenAIFormat) {
      // OpenAI 格式 → 转换为 Response API
      const openAIRequest = request as ChatCompletionRequest;

      if (!openAIRequest.model) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Invalid request: model is required",
              type: "invalid_request_error",
              code: "missing_required_fields",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      logger.debug("[ChatCompletions] OpenAI format detected, transforming...", {
        model: openAIRequest.model,
        stream: openAIRequest.stream,
        messageCount: openAIRequest.messages.length,
        hasTools: !!openAIRequest.tools,
        toolsCount: openAIRequest.tools?.length,
        hasReasoning: !!openAIRequest.reasoning,
        temperature: openAIRequest.temperature,
        max_tokens: openAIRequest.max_tokens,
      });

      // 开发模式：输出完整原始请求
      if (process.env.NODE_ENV === "development") {
        logger.debug("[ChatCompletions] Full OpenAI request:", {
          request: JSON.stringify(openAIRequest, null, 2),
        });
      }

      try {
        // 新架构：保持 OpenAI 格式，由 Forwarder 层根据 provider 类型进行转换
        // 这样可以支持多种 provider 类型（claude/codex/gemini-cli/openai-compatible）

        logger.debug("[ChatCompletions] Keeping OpenAI format for provider-level conversion:", {
          model: openAIRequest.model,
          messageCount: openAIRequest.messages.length,
          hasTools: !!openAIRequest.tools,
          stream: openAIRequest.stream,
        });

        // 直接使用 OpenAI 请求格式
        session.request.message = openAIRequest as unknown as Record<string, unknown>;
        session.request.model = openAIRequest.model;

        // 设置原始格式为 OpenAI（用于响应转换）
        session.setOriginalFormat("openai");

        // 验证转换结果（仅在开发环境）
        if (process.env.NODE_ENV === "development") {
          const msgObj = session.request.message as Record<string, unknown>;
          logger.debug("[ChatCompletions] Verification - session.request.message contains input:", {
            hasInput: "input" in msgObj,
            inputType: Array.isArray(msgObj.input) ? "array" : typeof msgObj.input,
            inputLength: Array.isArray(msgObj.input) ? msgObj.input.length : "N/A",
          });
        }

        // 标记为 OpenAI 格式（用于响应转换）
        session.setOriginalFormat("openai");
      } catch (transformError) {
        logger.error("[ChatCompletions] Request transformation failed:", {
          context: transformError,
        });
        return new Response(
          JSON.stringify({
            error: {
              message: "Failed to transform request format",
              type: "invalid_request_error",
              code: "transformation_error",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    } else if (isResponseAPIFormat) {
      // Response API 格式 → 直接透传
      logger.info("[ChatCompletions] Response API format detected, passing through");

      // 标记为 Response API 格式（响应也用 Response API 格式）
      session.setOriginalFormat("response");

      // 验证必需字段
      if (!request.model) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Invalid request: model is required",
              type: "invalid_request_error",
              code: "missing_required_fields",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // 复用现有代理流程
    // 1. 认证检查
    const unauthorized = await ProxyAuthenticator.ensure(session);
    if (unauthorized) {
      return unauthorized;
    }

    // 2. Session 分配（用于会话粘性）
    await ProxySessionGuard.ensure(session);

    // 3. 敏感词检查（在计费之前）
    const blockedBySensitiveWord = await ProxySensitiveWordGuard.ensure(session);
    if (blockedBySensitiveWord) {
      return blockedBySensitiveWord;
    }

    // 4. 限流检查
    await ProxyRateLimitGuard.ensure(session);

    // 5. 供应商选择（根据模型自动匹配）
    const providerUnavailable = await ProxyProviderResolver.ensure(session);
    if (providerUnavailable) {
      // 创建失败记录（供应商不可用）
      await ProxyMessageService.ensureContext(session);

      // 解析错误响应
      const errorBody = await providerUnavailable
        .clone()
        .json()
        .catch(() => null);
      const errorMessage = errorBody?.error?.message || "供应商不可用";

      // 记录失败消息
      if (session.messageContext) {
        const { updateMessageRequestDetails } = await import("@/repository/message");
        await updateMessageRequestDetails(session.messageContext.id, {
          statusCode: providerUnavailable.status,
          errorMessage: JSON.stringify(errorBody?.error || { message: errorMessage }),
        });
      }

      return providerUnavailable;
    }

    await ProxyMessageService.ensureContext(session);

    // 记录请求开始
    if (session.messageContext && session.provider) {
      const tracker = ProxyStatusTracker.getInstance();
      tracker.startRequest({
        userId: session.messageContext.user.id,
        userName: session.messageContext.user.name,
        requestId: session.messageContext.id,
        keyName: session.messageContext.key.name,
        providerId: session.provider.id,
        providerName: session.provider.name,
        model: session.request.model || "unknown",
      });
    }

    // 4. 转发请求（ModelRedirector 会在 Forwarder 中自动应用）
    const response = await ProxyForwarder.send(session);

    // 5. 响应处理（自动转换回 OpenAI 格式）
    return await ProxyResponseHandler.dispatch(session, response);
  } catch (error) {
    logger.error("[ChatCompletions] Handler error:", error);
    return await ProxyErrorHandler.handle(session, error);
  }
}
