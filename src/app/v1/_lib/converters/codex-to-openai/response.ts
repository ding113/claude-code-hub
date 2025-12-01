/**
 * Codex (Response API) → OpenAI Chat Completions 响应转换器
 *
 * 基于 CLIProxyAPI 的实现：
 * - /internal/translator/codex/openai/chat-completions/codex_openai_response.go
 *
 * 核心转换：
 * - response.created → 初始化（不输出）
 * - response.reasoning_summary_text.delta → delta.reasoning_content
 * - response.output_text.delta → delta.content
 * - response.output_item.done (function_call) → delta.tool_calls
 * - response.completed → finish_reason + usage
 *
 * SSE 事件映射（流式）：
 * - response.created → 记录 ID/model/createdAt
 * - response.reasoning_summary_text.delta → data: {...} (reasoning_content)
 * - response.output_text.delta → data: {...} (content)
 * - response.output_item.done → data: {...} (tool_calls)
 * - response.completed → data: {...} (finish_reason + usage) + data: [DONE]
 */

import type { Context } from "hono";
import { logger } from "@/lib/logger";
import { buildReverseMapFromRequest } from "../tool-name-mapper";
import type { TransformState } from "../types";

/**
 * 解析 SSE 数据行
 */
function parseSSELine(chunk: string): { event?: string; data?: string } | null {
  const lines = chunk.trim().split("\n");
  let data: string | undefined;

  for (const line of lines) {
    if (line.startsWith("data:")) {
      data = line.substring(5).trim();
      break;
    }
  }

  if (data) {
    return { data };
  }
  return null;
}

/**
 * 构建 OpenAI SSE 格式的响应
 */
function buildOpenAISSE(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * 扩展的转换状态（用于 Codex → OpenAI）
 */
interface CodexToOpenAIState extends TransformState {
  /** 响应 ID */
  responseId?: string;
  /** 创建时间戳 */
  createdAt?: number;
  /** 模型名称 */
  model?: string;
  /** 工具调用索引 */
  functionCallIndex?: number;
}

/**
 * 流式响应转换：Codex → OpenAI
 *
 * @param ctx - Hono 上下文
 * @param model - 模型名称
 * @param originalRequest - 原始请求体（用于工具名称映射）
 * @param transformedRequest - 转换后的请求体
 * @param chunk - 当前响应 chunk（Codex SSE 格式）
 * @param state - 状态对象（用于追踪响应 ID 和工具调用索引）
 * @returns 转换后的 SSE chunk 数组（OpenAI 格式）
 */
export function transformCodexStreamResponseToOpenAI(
  _ctx: Context,
  model: string,
  originalRequest: Record<string, unknown>,
  _transformedRequest: Record<string, unknown>,
  chunk: string,
  state?: TransformState
): string[] {
  // 初始化状态
  if (!state) {
    state = {
      hasToolCall: false,
      responseId: "",
      createdAt: 0,
      model,
      functionCallIndex: -1,
    } as CodexToOpenAIState;
  }

  const codexState = state as CodexToOpenAIState;

  // 解析 SSE 数据
  const parsed = parseSSELine(chunk);
  if (!parsed || !parsed.data) {
    return [];
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(parsed.data);
  } catch {
    logger.warn("[Codex→OpenAI] Failed to parse SSE data", { chunk });
    return [];
  }

  const eventType = data.type as string;
  if (!eventType) {
    return [];
  }

  // 构建工具名称反向映射（缩短名称 → 原始名称）
  const toolNameMap = buildReverseMapFromRequest(originalRequest);

  let output = "";
  const created = codexState.createdAt || Math.floor(Date.now() / 1000);

  switch (eventType) {
    case "response.created": {
      // 初始化状态，不输出
      const response = (data.response as Record<string, unknown>) || {};
      codexState.responseId = (response.id as string) || "";
      codexState.createdAt = (response.created_at as number) || created;
      codexState.model = (response.model as string) || model;
      break;
    }

    case "response.reasoning_summary_text.delta": {
      // → delta.reasoning_content
      const delta = (data.delta as string) || "";

      output = buildOpenAISSE({
        id: codexState.responseId,
        object: "chat.completion.chunk",
        created,
        model: codexState.model || model,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              reasoning_content: delta,
            },
            finish_reason: null,
          },
        ],
      });
      break;
    }

    case "response.reasoning_summary_text.done": {
      // → delta.reasoning_content (结束标记)
      output = buildOpenAISSE({
        id: codexState.responseId,
        object: "chat.completion.chunk",
        created,
        model: codexState.model || model,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              reasoning_content: "\n\n",
            },
            finish_reason: null,
          },
        ],
      });
      break;
    }

    case "response.output_text.delta": {
      // → delta.content
      const delta = (data.delta as string) || "";

      output = buildOpenAISSE({
        id: codexState.responseId,
        object: "chat.completion.chunk",
        created,
        model: codexState.model || model,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: delta,
            },
            finish_reason: null,
          },
        ],
      });
      break;
    }

    case "response.output_item.done": {
      // → delta.tool_calls
      const item = data.item as Record<string, unknown> | undefined;
      if (item?.type !== "function_call") {
        break;
      }

      codexState.hasToolCall = true;

      // 递增工具调用索引
      if (codexState.functionCallIndex === undefined) {
        codexState.functionCallIndex = -1;
      }
      codexState.functionCallIndex++;

      const callId = (item.call_id as string) || "";
      let name = (item.name as string) || "";

      // 恢复原始工具名称
      const originalName = toolNameMap.get(name);
      if (originalName) {
        name = originalName;
      }

      const argumentsStr = (item.arguments as string) || "";

      output = buildOpenAISSE({
        id: codexState.responseId,
        object: "chat.completion.chunk",
        created,
        model: codexState.model || model,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: codexState.functionCallIndex,
                  id: callId,
                  type: "function",
                  function: {
                    name,
                    arguments: argumentsStr,
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      break;
    }

    case "response.completed": {
      // → finish_reason + usage + [DONE]
      const response = data.response as Record<string, unknown> | undefined;
      const usage = response?.usage as Record<string, unknown> | undefined;
      const usagePayload = buildUsagePayload(usage);

      const finishReason = codexState.hasToolCall ? "tool_calls" : "stop";

      output = buildOpenAISSE({
        id: codexState.responseId,
        object: "chat.completion.chunk",
        created,
        model: codexState.model || model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: finishReason,
          },
        ],
        usage: usagePayload,
      });

      // 最后发送 [DONE]
      output += "data: [DONE]\n\n";
      break;
    }

    default:
      // 未知事件类型，跳过
      logger.debug("[Codex→OpenAI] Unknown event type", { eventType });
      break;
  }

  return output ? [output] : [];
}

/**
 * 非流式响应转换：Codex → OpenAI
 *
 * @param ctx - Hono 上下文
 * @param model - 模型名称
 * @param originalRequest - 原始请求体（用于工具名称映射）
 * @param transformedRequest - 转换后的请求体
 * @param response - 完整的 Codex 响应体
 * @returns 转换后的 OpenAI 响应体
 */
export function transformCodexNonStreamResponseToOpenAI(
  _ctx: Context,
  model: string,
  originalRequest: Record<string, unknown>,
  _transformedRequest: Record<string, unknown>,
  response: Record<string, unknown>
): Record<string, unknown> {
  // 检查响应类型
  if (response.type !== "response.completed") {
    logger.warn("[Codex→OpenAI] Invalid response type for non-stream", {
      type: response.type,
    });
    return response;
  }

  const responseData = response.response as Record<string, unknown> | undefined;
  if (!responseData) {
    logger.warn("[Codex→OpenAI] Missing response data");
    return response;
  }

  // 构建工具名称反向映射
  const toolNameMap = buildReverseMapFromRequest(originalRequest);

  const created = (responseData.created_at as number) || Math.floor(Date.now() / 1000);
  const responseModel = (responseData.model as string) || model;

  // 基础 OpenAI 响应结构
  const openaiResponse: Record<string, unknown> = {
    id: responseData.id || "",
    object: "chat.completion",
    created,
    model: responseModel,
    choices: [],
    usage: {},
  };

  let contentText = "";
  let reasoningText = "";
  const toolCalls: Array<Record<string, unknown>> = [];

  // 处理 output 数组
  const output = responseData.output as Array<Record<string, unknown>> | undefined;
  if (output && Array.isArray(output)) {
    for (const item of output) {
      const itemType = item.type as string;

      switch (itemType) {
        case "reasoning": {
          // 提取 reasoning 内容
          const summary = item.summary as Array<Record<string, unknown>> | undefined;
          if (summary && Array.isArray(summary)) {
            for (const summaryItem of summary) {
              if (summaryItem.type === "summary_text") {
                reasoningText = (summaryItem.text as string) || "";
                break;
              }
            }
          }
          break;
        }

        case "message": {
          // 提取 message 内容
          const content = item.content as Array<Record<string, unknown>> | undefined;
          if (content && Array.isArray(content)) {
            for (const contentItem of content) {
              if (contentItem.type === "output_text") {
                contentText = (contentItem.text as string) || "";
                break;
              }
            }
          }
          break;
        }

        case "function_call": {
          // 处理 function_call
          const callId = (item.call_id as string) || "";
          let name = (item.name as string) || "";
          const argumentsStr = (item.arguments as string) || "";

          // 恢复原始工具名称
          const originalName = toolNameMap.get(name);
          if (originalName) {
            name = originalName;
          }

          toolCalls.push({
            id: callId,
            type: "function",
            function: {
              name,
              arguments: argumentsStr,
            },
          });
          break;
        }
      }
    }
  }

  // 构建 choices[0].message
  const message: Record<string, unknown> = {
    role: "assistant",
  };

  if (contentText) {
    message.content = contentText;
  }

  if (reasoningText) {
    message.reasoning_content = reasoningText;
  }

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  // 设置 finish_reason
  const finishReason = toolCalls.length > 0 ? "tool_calls" : "stop";

  openaiResponse.choices = [
    {
      index: 0,
      message,
      finish_reason: finishReason,
    },
  ];

  // 设置 usage
  const usage = responseData.usage as Record<string, unknown> | undefined;
  openaiResponse.usage = buildUsagePayload(usage);

  logger.debug("[Codex→OpenAI] Non-stream response transformation completed", {
    hasContent: !!contentText,
    hasReasoning: !!reasoningText,
    toolCallsCount: toolCalls.length,
    finishReason,
  });

  return openaiResponse;
}

function buildUsagePayload(usage?: Record<string, unknown>): Record<string, unknown> {
  const inputTokens = (usage?.input_tokens as number) || 0;
  const outputTokens = (usage?.output_tokens as number) || 0;
  const totalTokens = (usage?.total_tokens as number) || inputTokens + outputTokens;

  const payload: Record<string, unknown> = {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: totalTokens,
  };

  const outputTokenDetails = usage?.output_tokens_details as Record<string, unknown> | undefined;
  if (outputTokenDetails && typeof outputTokenDetails.reasoning_tokens === "number") {
    payload.completion_tokens_details = {
      reasoning_tokens: outputTokenDetails.reasoning_tokens,
    };
  }

  if (typeof usage?.cache_creation_input_tokens === "number") {
    payload.cache_creation_input_tokens = usage.cache_creation_input_tokens;
  }

  if (typeof usage?.cache_read_input_tokens === "number") {
    payload.cache_read_input_tokens = usage.cache_read_input_tokens;
  }

  const cacheCreationDetails =
    (usage?.cache_creation_input_token_details as Record<string, unknown>) ||
    (usage?.cache_creation_input_tokens_details as Record<string, unknown>) ||
    undefined;
  if (cacheCreationDetails) {
    payload.cache_creation_input_token_details = cacheCreationDetails;
  }

  const cacheReadDetails =
    (usage?.cache_read_input_token_details as Record<string, unknown>) ||
    (usage?.cache_read_input_tokens_details as Record<string, unknown>) ||
    undefined;
  if (cacheReadDetails) {
    payload.cache_read_input_token_details = cacheReadDetails;
  }

  return payload;
}
