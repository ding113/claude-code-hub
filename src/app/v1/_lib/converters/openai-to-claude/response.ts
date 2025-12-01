/**
 * Claude Messages API → OpenAI Chat Completions 响应转换器
 *
 * 核心转换：
 * - content.text → choices[].message.content
 * - tool_use → choices[].message.tool_calls[]
 * - thinking → choices[].message.reasoning_content（OpenAI o3 格式）
 * - usage → usage（prompt_tokens + completion_tokens）
 *
 * SSE 事件映射（流式）：
 * - message_start → data: {...} (初始化)
 * - content_block_start → data: {...} (content 开始)
 * - content_block_delta → data: {...} (delta)
 * - content_block_stop → (跳过)
 * - message_delta → data: {...} (usage + stop_reason)
 * - message_stop → data: {...} + data: [DONE]
 */

import type { Context } from "hono";
import { logger } from "@/lib/logger";
import type { TransformState } from "../types";

/**
 * 解析 SSE 数据行
 */
function parseSSELine(chunk: string): { event?: string; data?: string } | null {
  const lines = chunk.trim().split("\n");
  let event: string | undefined;
  let data: string | undefined;

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.substring(6).trim();
    } else if (line.startsWith("data:")) {
      data = line.substring(5).trim();
    }
  }

  if (data) {
    return { event, data };
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
 * 流式响应转换：Claude → OpenAI
 *
 * @param ctx - Hono 上下文
 * @param model - 模型名称
 * @param originalRequest - 原始请求体
 * @param transformedRequest - 转换后的请求体
 * @param chunk - 当前响应 chunk（Claude SSE 格式）
 * @param state - 状态对象（用于追踪 tool calls 和 index）
 * @returns 转换后的 SSE chunk 数组（OpenAI 格式）
 */
export function transformClaudeStreamResponseToOpenAI(
  _ctx: Context,
  model: string,
  _originalRequest: Record<string, unknown>,
  _transformedRequest: Record<string, unknown>,
  chunk: string,
  state?: TransformState
): string[] {
  // 初始化状态
  if (!state) {
    state = {
      hasToolCall: false,
      currentIndex: 0,
      messageId: "",
      toolCalls: {},
      thinkingContent: "",
    };
  }

  // 解析 SSE 数据
  const parsed = parseSSELine(chunk);
  if (!parsed || !parsed.data) {
    return [];
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(parsed.data);
  } catch {
    logger.warn("[Claude→OpenAI] Failed to parse SSE data", { chunk });
    return [];
  }

  const eventType = data.type as string;
  if (!eventType) {
    return [];
  }

  let output = "";
  const created = Math.floor(Date.now() / 1000);

  switch (eventType) {
    case "message_start": {
      // 初始化
      const message = (data.message as Record<string, unknown>) || {};
      state.messageId = (message.id as string) || "";

      output = buildOpenAISSE({
        id: state.messageId,
        object: "chat.completion.chunk",
        created,
        model: (message.model as string) || model,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "" },
            finish_reason: null,
          },
        ],
      });
      break;
    }

    case "content_block_start": {
      const index = data.index as number;
      const contentBlock = (data.content_block as Record<string, unknown>) || {};
      const blockType = contentBlock.type as string;

      state.currentIndex = index;
      state.currentBlockType = blockType as "text" | "thinking" | "tool_use";

      if (blockType === "tool_use") {
        state.hasToolCall = true;

        // 初始化 tool call
        const toolUseId = contentBlock.id as string;
        const toolName = contentBlock.name as string;

        if (!state.toolCalls) {
          state.toolCalls = {};
        }

        const toolCalls = state.toolCalls as Record<
          number,
          {
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }
        >;

        toolCalls[index] = {
          id: toolUseId,
          type: "function",
          function: {
            name: toolName,
            arguments: "",
          },
        };

        // OpenAI 在第一个 tool_call 开始时发送 tool_calls 数组初始化
        output = buildOpenAISSE({
          id: state.messageId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index,
                    id: toolUseId,
                    type: "function",
                    function: {
                      name: toolName,
                      arguments: "",
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
      }
      // text 和 thinking 在 content_block_start 时不输出
      break;
    }

    case "content_block_delta": {
      const index = data.index as number;
      const delta = (data.delta as Record<string, unknown>) || {};
      const deltaType = delta.type as string;

      if (deltaType === "text_delta") {
        // 文本增量
        const text = (delta.text as string) || "";

        output = buildOpenAISSE({
          id: state.messageId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { content: text },
              finish_reason: null,
            },
          ],
        });
      } else if (deltaType === "thinking_delta") {
        // 思考内容（OpenAI o3 格式）
        const thinking = (delta.thinking as string) || "";

        if (!state.thinkingContent) {
          state.thinkingContent = "";
        }
        state.thinkingContent += thinking;

        // OpenAI o3 使用 reasoning_content 字段
        output = buildOpenAISSE({
          id: state.messageId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { reasoning_content: thinking },
              finish_reason: null,
            },
          ],
        });
      } else if (deltaType === "input_json_delta") {
        // Tool call arguments 增量
        const partialJson = (delta.partial_json as string) || "";

        const toolCalls = state.toolCalls as
          | Record<
              number,
              {
                id: string;
                type: string;
                function: { name: string; arguments: string };
              }
            >
          | undefined;

        if (toolCalls?.[index]) {
          toolCalls[index].function.arguments += partialJson;
        }

        output = buildOpenAISSE({
          id: state.messageId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index,
                    function: {
                      arguments: partialJson,
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
      }
      break;
    }

    case "content_block_stop": {
      // OpenAI 在 content_block_stop 时不发送事件，等待 message_stop
      break;
    }

    case "message_delta": {
      // Claude 的 message_delta 包含 stop_reason 和 usage
      const delta = (data.delta as Record<string, unknown>) || {};
      const usage = (data.usage as Record<string, unknown>) || {};

      state.stopReason = (delta.stop_reason as string) || "stop";
      state.stopSequence = (delta.stop_sequence as string) || null;
      state.finalUsage = usage;

      // 不输出，等待 message_stop
      break;
    }

    case "message_stop": {
      // 结束事件
      const stopReason = state.stopReason || "stop";
      const usage = (state.finalUsage || {}) as Record<string, unknown>;

      // 映射 stop_reason
      let finishReason = "stop";
      switch (stopReason) {
        case "end_turn":
          finishReason = "stop";
          break;
        case "max_tokens":
          finishReason = "length";
          break;
        case "tool_use":
          finishReason = "tool_calls";
          break;
        case "stop_sequence":
          finishReason = "stop";
          break;
        default:
          finishReason = "stop";
      }

      output = buildOpenAISSE({
        id: state.messageId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: finishReason,
          },
        ],
        usage: {
          prompt_tokens: (usage.input_tokens as number) || 0,
          completion_tokens: (usage.output_tokens as number) || 0,
          total_tokens:
            ((usage.input_tokens as number) || 0) + ((usage.output_tokens as number) || 0),
        },
      });

      // 最后发送 [DONE]
      output += "data: [DONE]\n\n";
      break;
    }

    default:
      // 未知事件类型，跳过
      logger.debug("[Claude→OpenAI] Unknown event type", { eventType });
      break;
  }

  return output ? [output] : [];
}

/**
 * 非流式响应转换：Claude → OpenAI
 *
 * @param ctx - Hono 上下文
 * @param model - 模型名称
 * @param originalRequest - 原始请求体
 * @param transformedRequest - 转换后的请求体
 * @param response - 完整的 Claude 响应体
 * @returns 转换后的 OpenAI 响应体
 */
export function transformClaudeNonStreamResponseToOpenAI(
  _ctx: Context,
  model: string,
  _originalRequest: Record<string, unknown>,
  _transformedRequest: Record<string, unknown>,
  response: Record<string, unknown>
): Record<string, unknown> {
  // 检查响应类型
  if (response.type !== "message") {
    logger.warn("[Claude→OpenAI] Invalid response type for non-stream", {
      type: response.type,
    });
    return response;
  }

  const content = response.content as Array<Record<string, unknown>>;

  let textContent = "";
  let reasoningContent = "";
  const toolCalls: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }> = [];

  // 处理 content 数组
  for (const block of content || []) {
    const blockType = block.type as string;

    switch (blockType) {
      case "text":
        textContent += (block.text as string) || "";
        break;

      case "thinking":
        reasoningContent += (block.thinking as string) || "";
        break;

      case "tool_use":
        toolCalls.push({
          id: block.id as string,
          type: "function",
          function: {
            name: block.name as string,
            arguments: JSON.stringify(block.input || {}),
          },
        });
        break;
    }
  }

  // 映射 stop_reason
  const stopReason = (response.stop_reason as string) || "end_turn";
  let finishReason = "stop";
  switch (stopReason) {
    case "end_turn":
      finishReason = "stop";
      break;
    case "max_tokens":
      finishReason = "length";
      break;
    case "tool_use":
      finishReason = "tool_calls";
      break;
    case "stop_sequence":
      finishReason = "stop";
      break;
  }

  const usage = (response.usage as Record<string, unknown>) || {};

  return {
    id: response.id || "",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: response.model || model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: textContent || null,
          ...(reasoningContent && { reasoning_content: reasoningContent }),
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: (usage.input_tokens as number) || 0,
      completion_tokens: (usage.output_tokens as number) || 0,
      total_tokens: ((usage.input_tokens as number) || 0) + ((usage.output_tokens as number) || 0),
    },
  };
}
