/**
 * Claude Messages API → Codex (Response API) 响应转换器
 *
 * 基于 CLIProxyAPI 的逆向实现：
 * - /internal/translator/codex/claude/codex_claude_response.go 的逆向
 *
 * 实现 SSE 事件流逆向转换，将 Claude 的响应事件转换为 Codex 格式。
 *
 * 核心映射（逆向）：
 * - message_start → response.created
 * - content_block_start (thinking) → response.reasoning_summary_part.added
 * - content_block_delta (thinking_delta) → response.reasoning_summary_text.delta
 * - content_block_stop → response.reasoning_summary_part.done
 * - content_block_start (text) → response.content_part.added
 * - content_block_delta (text_delta) → response.output_text.delta
 * - content_block_stop → response.content_part.done
 * - content_block_start (tool_use) → response.output_item.added (function_call)
 * - content_block_delta (input_json_delta) → response.function_call_arguments.delta
 * - content_block_stop → response.output_item.done
 * - message_delta + message_stop → response.completed
 */

import type { Context } from "hono";
import { logger } from "@/lib/logger";
import { buildForwardMapFromRequest } from "../tool-name-mapper";
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
 * 构建 SSE 格式的响应
 */
function buildSSE(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * 流式响应转换：Claude → Codex
 *
 * @param ctx - Hono 上下文
 * @param model - 模型名称
 * @param originalRequest - 原始请求体（用于工具名称映射）
 * @param transformedRequest - 转换后的请求体
 * @param chunk - 当前响应 chunk（Claude SSE 格式）
 * @param state - 状态对象（用于追踪工具调用和 index）
 * @returns 转换后的 SSE chunk 数组（Codex 格式）
 */
export function transformClaudeStreamResponseToCodex(
  _ctx: Context,
  model: string,
  _originalRequest: Record<string, unknown>,
  transformedRequest: Record<string, unknown>,
  chunk: string,
  state?: TransformState
): string[] {
  // 初始化状态
  if (!state) {
    state = { hasToolCall: false, currentIndex: 0 };
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
    logger.warn("[Claude→Codex] Failed to parse SSE data", { chunk });
    return [];
  }

  const eventType = data.type as string;
  if (!eventType) {
    return [];
  }

  // 构建工具名称正向映射（原始名称 → 缩短名称）
  const toolNameMap = buildForwardMapFromRequest(transformedRequest);

  let output = "";

  switch (eventType) {
    case "message_start": {
      // → response.created
      const message = (data.message as Record<string, unknown>) || {};
      const responseId = message.id || "";
      const responseModel = message.model || model || "claude-opus-4-20250514";

      output = buildSSE("response.created", {
        type: "response.created",
        response: {
          id: responseId,
          type: "response",
          model: responseModel,
          output: [],
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
        },
      });
      break;
    }

    case "content_block_start": {
      const index = data.index as number;
      const contentBlock = (data.content_block as Record<string, unknown>) || {};
      const blockType = contentBlock.type as string;

      // 更新当前 index 和类型
      state.currentIndex = index;
      state.currentBlockType = blockType as "text" | "thinking" | "tool_use";

      if (blockType === "thinking") {
        // → response.reasoning_summary_part.added
        output = buildSSE("response.reasoning_summary_part.added", {
          type: "response.reasoning_summary_part.added",
          output_index: index,
          part: {
            type: "reasoning",
            summary: [],
          },
        });
      } else if (blockType === "text") {
        // → response.content_part.added
        output = buildSSE("response.content_part.added", {
          type: "response.content_part.added",
          output_index: index,
          part: {
            type: "message",
            role: "assistant",
            content: [],
          },
        });
      } else if (blockType === "tool_use") {
        state.hasToolCall = true;

        const toolUseId = contentBlock.id as string;
        let toolName = contentBlock.name as string;

        // 应用工具名称映射（原始名称 → 缩短名称）
        const mappedName = toolNameMap.get(toolName);
        if (mappedName) {
          toolName = mappedName;
        }

        // → response.output_item.added
        output = buildSSE("response.output_item.added", {
          type: "response.output_item.added",
          output_index: index,
          item: {
            type: "function_call",
            call_id: toolUseId,
            name: toolName,
            arguments: "",
          },
        });
      }
      break;
    }

    case "content_block_delta": {
      const index = data.index as number;
      const delta = (data.delta as Record<string, unknown>) || {};
      const deltaType = delta.type as string;

      if (deltaType === "thinking_delta") {
        // → response.reasoning_summary_text.delta
        const thinking = (delta.thinking as string) || "";

        output = buildSSE("response.reasoning_summary_text.delta", {
          type: "response.reasoning_summary_text.delta",
          output_index: index,
          delta: thinking,
        });
      } else if (deltaType === "text_delta") {
        // → response.output_text.delta
        const text = (delta.text as string) || "";

        output = buildSSE("response.output_text.delta", {
          type: "response.output_text.delta",
          output_index: index,
          delta: text,
        });
      } else if (deltaType === "input_json_delta") {
        // → response.function_call_arguments.delta
        const partialJson = (delta.partial_json as string) || "";

        output = buildSSE("response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta",
          output_index: index,
          delta: partialJson,
        });
      }
      break;
    }

    case "content_block_stop": {
      const index = data.index as number;
      const blockType = state.currentBlockType;

      if (blockType === "thinking") {
        // → response.reasoning_summary_part.done
        output = buildSSE("response.reasoning_summary_part.done", {
          type: "response.reasoning_summary_part.done",
          output_index: index,
        });
      } else if (blockType === "text") {
        // → response.content_part.done
        output = buildSSE("response.content_part.done", {
          type: "response.content_part.done",
          output_index: index,
        });
      } else if (blockType === "tool_use") {
        // → response.output_item.done
        output = buildSSE("response.output_item.done", {
          type: "response.output_item.done",
          output_index: index,
        });
      }
      break;
    }

    case "message_delta": {
      // Claude 的 message_delta 包含 stop_reason 和 usage
      // 缓存到状态中，等待 message_stop 再输出 response.completed
      const delta = (data.delta as Record<string, unknown>) || {};
      const usage = (data.usage as Record<string, unknown>) || {};

      state.stopReason = (delta.stop_reason as string) || "end_turn";
      state.stopSequence = (delta.stop_sequence as string) || null;
      state.finalUsage = usage;

      // 不输出，等待 message_stop
      break;
    }

    case "message_stop": {
      // → response.completed
      const stopReason = state.stopReason || "end_turn";
      const stopSequence = state.stopSequence || null;
      const usage = (state.finalUsage || {}) as Record<string, unknown>;

      output = buildSSE("response.completed", {
        type: "response.completed",
        response: {
          stop_reason: stopReason,
          stop_sequence: stopSequence,
          usage: {
            input_tokens: (usage.input_tokens as number) || 0,
            output_tokens: (usage.output_tokens as number) || 0,
          },
        },
      });
      break;
    }

    default:
      // 未知事件类型，跳过
      logger.debug("[Claude→Codex] Unknown event type", { eventType });
      break;
  }

  return output ? [output] : [];
}

/**
 * 非流式响应转换：Claude → Codex
 *
 * @param ctx - Hono 上下文
 * @param model - 模型名称
 * @param originalRequest - 原始请求体（用于工具名称映射）
 * @param transformedRequest - 转换后的请求体
 * @param response - 完整的 Claude 响应体
 * @returns 转换后的 Codex 响应体
 */
export function transformClaudeNonStreamResponseToCodex(
  _ctx: Context,
  model: string,
  _originalRequest: Record<string, unknown>,
  transformedRequest: Record<string, unknown>,
  response: Record<string, unknown>
): Record<string, unknown> {
  // 检查响应类型
  if (response.type !== "message") {
    logger.warn("[Claude→Codex] Invalid response type for non-stream", {
      type: response.type,
    });
    return response;
  }

  // 构建工具名称正向映射
  const toolNameMap = buildForwardMapFromRequest(transformedRequest);

  // 基础响应结构
  const codexResponse: Record<string, unknown> = {
    type: "response.completed",
    response: {
      id: response.id || "",
      type: "response",
      model: response.model || model || "claude-opus-4-20250514",
      output: [],
      stop_reason: response.stop_reason || "end_turn",
      stop_sequence: response.stop_sequence || null,
      usage: {
        input_tokens: ((response.usage as Record<string, unknown>)?.input_tokens as number) || 0,
        output_tokens: ((response.usage as Record<string, unknown>)?.output_tokens as number) || 0,
      },
    },
  };

  const outputItems: Array<Record<string, unknown>> = [];

  // 处理 content 数组
  const content = response.content as Array<Record<string, unknown>> | undefined;
  if (content && Array.isArray(content)) {
    for (const block of content) {
      const blockType = block.type as string;

      switch (blockType) {
        case "thinking": {
          // 转换为 reasoning
          const thinkingText = (block.thinking as string) || "";

          outputItems.push({
            type: "reasoning",
            summary: [
              {
                type: "text",
                text: thinkingText,
              },
            ],
          });
          break;
        }

        case "text": {
          // 转换为 message
          const text = (block.text as string) || "";

          outputItems.push({
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text,
              },
            ],
          });
          break;
        }

        case "tool_use": {
          // 转换为 function_call
          const toolUseId = block.id as string;
          let toolName = block.name as string;
          const input = (block.input as Record<string, unknown>) || {};

          // 应用工具名称映射
          const mappedName = toolNameMap.get(toolName);
          if (mappedName) {
            toolName = mappedName;
          }

          // 序列化 input
          const argumentsStr = JSON.stringify(input);

          outputItems.push({
            type: "function_call",
            call_id: toolUseId,
            name: toolName,
            arguments: argumentsStr,
          });
          break;
        }
      }
    }
  }

  // 设置 output
  (codexResponse.response as Record<string, unknown>).output = outputItems;

  logger.debug("[Claude→Codex] Non-stream response transformation completed", {
    outputItemCount: outputItems.length,
    stopReason:
      codexResponse.response &&
      typeof codexResponse.response === "object" &&
      "stop_reason" in codexResponse.response
        ? (codexResponse.response as Record<string, unknown>).stop_reason
        : "unknown",
  });

  return codexResponse;
}
