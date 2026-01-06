/**
 * OpenAI Compatible API Handler (/v1/chat/completions)
 *
 * 致谢：本文件中的 OpenAI 兼容层实现参考了以下开源项目：
 * - https://github.com/router-for-me/CLIProxyAPI (MIT License)
 * 感谢原作者的优秀工作和开源贡献！
 */

import type { Context } from "hono";
import { logger } from "@/lib/logger";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";
import { SessionTracker } from "@/lib/session-tracker";
import { ProxyErrorHandler } from "../proxy/error-handler";
import { ProxyError } from "../proxy/errors";
import { ProxyForwarder } from "../proxy/forwarder";
import { GuardPipelineBuilder, RequestType } from "../proxy/guard-pipeline";
import { ProxyResponseHandler } from "../proxy/response-handler";
import { ProxyResponses } from "../proxy/responses";
import { ProxySession } from "../proxy/session";
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

  let session: ProxySession | null = null;

  try {
    session = await ProxySession.fromContext(c);

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

    const type = session.isCountTokensRequest() ? RequestType.COUNT_TOKENS : RequestType.CHAT;
    const pipeline = GuardPipelineBuilder.fromRequestType(type);

    const early = await pipeline.run(session);
    if (early) return early;

    // 增加并发计数（在所有检查通过后，请求开始前）- 跳过 count_tokens
    if (session.sessionId && !session.isCountTokensRequest()) {
      await SessionTracker.incrementConcurrentCount(session.sessionId);
    }

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
    if (session) {
      return await ProxyErrorHandler.handle(session, error);
    }

    if (error instanceof ProxyError) {
      return ProxyResponses.buildError(error.statusCode, error.getClientSafeMessage());
    }

    return ProxyResponses.buildError(500, "代理请求发生未知错误");
  } finally {
    // 减少并发计数（确保无论成功失败都执行）- 跳过 count_tokens
    if (session?.sessionId && !session.isCountTokensRequest()) {
      await SessionTracker.decrementConcurrentCount(session.sessionId);
    }
  }
}
