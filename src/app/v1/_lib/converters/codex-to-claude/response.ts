/**
 * Codex (Response API) → Claude Messages API 响应转换器
 *
 * 基于 CLIProxyAPI 的实现：
 * - /internal/translator/codex/claude/codex_claude_response.go
 *
 * 实现 SSE 事件流状态机，将 Codex 的响应事件转换为 Claude 格式。
 *
 * 核心映射：
 * - response.created → message_start
 * - response.reasoning_summary_part.added → content_block_start (thinking)
 * - response.reasoning_summary_text.delta → content_block_delta (thinking_delta)
 * - response.reasoning_summary_part.done → content_block_stop
 * - response.content_part.added → content_block_start (text)
 * - response.output_text.delta → content_block_delta (text_delta)
 * - response.content_part.done → content_block_stop
 * - response.output_item.added (function_call) → content_block_start (tool_use)
 * - response.function_call_arguments.delta → content_block_delta (input_json_delta)
 * - response.output_item.done (function_call) → content_block_stop
 * - response.completed → message_delta + message_stop
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
 * 流式响应转换：Codex → Claude
 *
 * @param ctx - Hono 上下文
 * @param model - 模型名称
 * @param originalRequest - 原始请求体（用于工具名称映射）
 * @param transformedRequest - 转换后的请求体
 * @param chunk - 当前响应 chunk（SSE 格式）
 * @param state - 状态对象（用于追踪工具调用）
 * @returns 转换后的 SSE chunk 数组
 */
export function transformCodexStreamResponseToClaude(
  _ctx: Context,
  _model: string,
  originalRequest: Record<string, unknown>,
  _transformedRequest: Record<string, unknown>,
  chunk: string,
  state?: TransformState
): string[] {
  // 初始化状态
  if (!state) {
    state = { hasToolCall: false };
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
    logger.warn("[Codex→Claude] Failed to parse SSE data", { chunk });
    return [];
  }

  const eventType = data.type as string;
  if (!eventType) {
    return [];
  }

  // 构建工具名称反向映射（缩短名称 → 原始名称）
  const toolNameMap = buildReverseMapFromRequest(originalRequest);

  let output = "";

  switch (eventType) {
    case "response.created": {
      // → message_start
      const responseId = (data.response as Record<string, unknown>)?.id || "";
      const responseModel =
        (data.response as Record<string, unknown>)?.model || "claude-opus-4-1-20250805";

      output = buildSSE("message_start", {
        type: "message_start",
        message: {
          id: responseId,
          type: "message",
          role: "assistant",
          model: responseModel,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
          content: [],
          stop_reason: null,
        },
      });
      break;
    }

    case "response.reasoning_summary_part.added": {
      // → content_block_start (thinking)
      const outputIndex = data.output_index || 0;

      output = buildSSE("content_block_start", {
        type: "content_block_start",
        index: outputIndex,
        content_block: {
          type: "thinking",
          thinking: "",
        },
      });
      break;
    }

    case "response.reasoning_summary_text.delta": {
      // → content_block_delta (thinking_delta)
      const outputIndex = data.output_index || 0;
      const delta = data.delta || "";

      output = buildSSE("content_block_delta", {
        type: "content_block_delta",
        index: outputIndex,
        delta: {
          type: "thinking_delta",
          thinking: delta,
        },
      });
      break;
    }

    case "response.reasoning_summary_part.done": {
      // → content_block_stop
      const outputIndex = data.output_index || 0;

      output = buildSSE("content_block_stop", {
        type: "content_block_stop",
        index: outputIndex,
      });
      break;
    }

    case "response.content_part.added": {
      // → content_block_start (text)
      const outputIndex = data.output_index || 0;

      output = buildSSE("content_block_start", {
        type: "content_block_start",
        index: outputIndex,
        content_block: {
          type: "text",
          text: "",
        },
      });
      break;
    }

    case "response.output_text.delta": {
      // → content_block_delta (text_delta)
      const outputIndex = data.output_index || 0;
      const delta = data.delta || "";

      output = buildSSE("content_block_delta", {
        type: "content_block_delta",
        index: outputIndex,
        delta: {
          type: "text_delta",
          text: delta,
        },
      });
      break;
    }

    case "response.content_part.done": {
      // → content_block_stop
      const outputIndex = data.output_index || 0;

      output = buildSSE("content_block_stop", {
        type: "content_block_stop",
        index: outputIndex,
      });
      break;
    }

    case "response.output_item.added": {
      // → content_block_start (tool_use)
      const item = data.item as Record<string, unknown> | undefined;
      if (item?.type === "function_call") {
        state.hasToolCall = true;

        const outputIndex = data.output_index || 0;
        const callId = item.call_id as string;
        let name = item.name as string;

        // 恢复原始工具名称
        const originalName = toolNameMap.get(name);
        if (originalName) {
          name = originalName;
        }

        // content_block_start
        output = buildSSE("content_block_start", {
          type: "content_block_start",
          index: outputIndex,
          content_block: {
            type: "tool_use",
            id: callId,
            name,
            input: {},
          },
        });

        // 立即发送空的 input_json_delta
        output += buildSSE("content_block_delta", {
          type: "content_block_delta",
          index: outputIndex,
          delta: {
            type: "input_json_delta",
            partial_json: "",
          },
        });
      }
      break;
    }

    case "response.function_call_arguments.delta": {
      // → content_block_delta (input_json_delta)
      const outputIndex = data.output_index || 0;
      const delta = data.delta || "";

      output = buildSSE("content_block_delta", {
        type: "content_block_delta",
        index: outputIndex,
        delta: {
          type: "input_json_delta",
          partial_json: delta,
        },
      });
      break;
    }

    case "response.output_item.done": {
      // → content_block_stop
      const item = data.item as Record<string, unknown> | undefined;
      if (item?.type === "function_call") {
        const outputIndex = data.output_index || 0;

        output = buildSSE("content_block_stop", {
          type: "content_block_stop",
          index: outputIndex,
        });
      }
      break;
    }

    case "response.completed": {
      // → message_delta + message_stop
      const response = data.response as Record<string, unknown> | undefined;
      const usage = response?.usage as Record<string, unknown> | undefined;

      const stopReason = state.hasToolCall ? "tool_use" : "end_turn";

      output = buildSSE("message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: stopReason,
          stop_sequence: null,
        },
        usage: {
          input_tokens: usage?.input_tokens || 0,
          output_tokens: usage?.output_tokens || 0,
        },
      });

      output += buildSSE("message_stop", {
        type: "message_stop",
      });
      break;
    }

    default:
      // 未知事件类型，跳过
      logger.debug("[Codex→Claude] Unknown event type", { eventType });
      break;
  }

  return output ? [output] : [];
}

/**
 * 非流式响应转换：Codex → Claude
 *
 * @param ctx - Hono 上下文
 * @param model - 模型名称
 * @param originalRequest - 原始请求体（用于工具名称映射）
 * @param transformedRequest - 转换后的请求体
 * @param response - 完整的 Codex 响应体
 * @returns 转换后的 Claude 响应体
 */
export function transformCodexNonStreamResponseToClaude(
  _ctx: Context,
  _model: string,
  originalRequest: Record<string, unknown>,
  _transformedRequest: Record<string, unknown>,
  response: Record<string, unknown>
): Record<string, unknown> {
  // 检查响应类型
  if (response.type !== "response.completed") {
    logger.warn("[Codex→Claude] Invalid response type for non-stream", {
      type: response.type,
    });
    return response;
  }

  const responseData = response.response as Record<string, unknown> | undefined;
  if (!responseData) {
    logger.warn("[Codex→Claude] Missing response data");
    return response;
  }

  // 构建工具名称反向映射
  const toolNameMap = buildReverseMapFromRequest(originalRequest);

  // 基础响应结构
  const claudeResponse: Record<string, unknown> = {
    id: responseData.id || "",
    type: "message",
    role: "assistant",
    model: responseData.model || "claude-opus-4-1-20250805",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: (responseData.usage as Record<string, unknown>)?.input_tokens || 0,
      output_tokens: (responseData.usage as Record<string, unknown>)?.output_tokens || 0,
    },
  };

  const contentBlocks: Array<Record<string, unknown>> = [];
  let hasToolCall = false;

  // 处理 output 数组
  const output = responseData.output as Array<Record<string, unknown>> | undefined;
  if (output && Array.isArray(output)) {
    for (const item of output) {
      const itemType = item.type as string;

      switch (itemType) {
        case "reasoning": {
          // 提取 thinking 内容
          let thinkingText = "";

          // 优先使用 summary
          const summary = item.summary;
          if (summary) {
            if (Array.isArray(summary)) {
              thinkingText = summary
                .map((part) => {
                  if (typeof part === "object" && part !== null && "text" in part) {
                    return (part as Record<string, unknown>).text as string;
                  }
                  return String(part);
                })
                .join("");
            } else {
              thinkingText = String(summary);
            }
          }

          // 如果没有 summary，尝试使用 content
          if (!thinkingText) {
            const content = item.content;
            if (content) {
              if (Array.isArray(content)) {
                thinkingText = content
                  .map((part) => {
                    if (typeof part === "object" && part !== null && "text" in part) {
                      return (part as Record<string, unknown>).text as string;
                    }
                    return String(part);
                  })
                  .join("");
              } else {
                thinkingText = String(content);
              }
            }
          }

          if (thinkingText) {
            contentBlocks.push({
              type: "thinking",
              thinking: thinkingText,
            });
          }
          break;
        }

        case "message": {
          // 提取文本内容
          const content = item.content;
          if (content) {
            if (Array.isArray(content)) {
              for (const part of content) {
                if (
                  typeof part === "object" &&
                  part !== null &&
                  (part as Record<string, unknown>).type === "output_text"
                ) {
                  const text = (part as Record<string, unknown>).text as string;
                  if (text) {
                    contentBlocks.push({
                      type: "text",
                      text,
                    });
                  }
                }
              }
            } else {
              const text = String(content);
              if (text) {
                contentBlocks.push({
                  type: "text",
                  text,
                });
              }
            }
          }
          break;
        }

        case "function_call": {
          hasToolCall = true;

          let name = item.name as string;
          const callId = item.call_id as string;
          const argumentsStr = item.arguments as string;

          // 恢复原始工具名称
          const originalName = toolNameMap.get(name);
          if (originalName) {
            name = originalName;
          }

          // 解析 arguments
          let input: Record<string, unknown> = {};
          if (argumentsStr) {
            try {
              input = JSON.parse(argumentsStr);
            } catch {
              logger.warn("[Codex→Claude] Failed to parse tool arguments", {
                name,
                callId,
              });
            }
          }

          contentBlocks.push({
            type: "tool_use",
            id: callId,
            name,
            input,
          });
          break;
        }
      }
    }
  }

  // 设置 content
  if (contentBlocks.length > 0) {
    claudeResponse.content = contentBlocks;
  }

  // 设置 stop_reason
  const stopReason = responseData.stop_reason as string;
  if (stopReason) {
    claudeResponse.stop_reason = stopReason;
  } else if (hasToolCall) {
    claudeResponse.stop_reason = "tool_use";
  } else {
    claudeResponse.stop_reason = "end_turn";
  }

  // 设置 stop_sequence（如果有）
  const stopSequence = responseData.stop_sequence;
  if (stopSequence !== null && stopSequence !== undefined && stopSequence !== "") {
    claudeResponse.stop_sequence = stopSequence;
  }

  logger.debug("[Codex→Claude] Non-stream response transformation completed", {
    contentBlockCount: contentBlocks.length,
    hasToolCall,
    stopReason: claudeResponse.stop_reason,
  });

  return claudeResponse;
}
