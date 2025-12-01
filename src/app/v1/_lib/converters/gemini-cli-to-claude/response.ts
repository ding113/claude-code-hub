/**
 * Gemini CLI → Claude Messages API 响应转换器
 *
 * 基于 CLIProxyAPI 的实现：
 * - /internal/translator/gemini-cli/claude/gemini-cli_claude_response.go
 *
 * 实现复杂的 SSE 事件流状态机，将 Gemini CLI 的响应事件转换为 Claude 格式。
 *
 * Gemini CLI 响应格式：
 * - response.candidates[0].content.parts[]: 包含 text 和 functionCall
 * - 每个 part 可能有 thought: true 标记（内部推理）
 * - 流式响应通过 JSON 块传输（非 SSE）
 *
 * Claude 响应格式（SSE）：
 * - event: message_start → event: content_block_start → event: content_block_delta → event: content_block_stop → event: message_stop
 *
 * 状态机：
 * - 0: 无内容块
 * - 1: 常规文本内容（text）
 * - 2: 推理内容（thinking）
 * - 3: 工具调用（function）
 */

import type { Context } from "hono";
import { logger } from "@/lib/logger";
import type { TransformState } from "../types";

/**
 * 响应转换状态
 */
interface GeminiResponseState extends TransformState {
  hasFirstResponse?: boolean; // 是否已发送 message_start
  responseType?: number; // 当前响应类型：0=none, 1=text, 2=thinking, 3=function
  responseIndex?: number; // 当前内容块索引
  usedTool?: boolean; // 是否使用了工具
}

/**
 * 构建 SSE 格式的响应
 */
function buildSSE(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n\n`;
}

/**
 * 流式响应转换：Gemini CLI → Claude
 *
 * @param ctx - Hono 上下文
 * @param model - 模型名称
 * @param originalRequest - 原始请求体
 * @param transformedRequest - 转换后的请求体
 * @param chunk - 当前响应 chunk（JSON 字符串）
 * @param state - 状态对象
 * @returns 转换后的 SSE chunk 数组
 */
export function transformGeminiCLIStreamResponseToClaude(
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
      hasFirstResponse: false,
      responseType: 0,
      responseIndex: 0,
      usedTool: false,
    } as GeminiResponseState;
  }

  const geminiState = state as GeminiResponseState;

  // 处理 [DONE] 结束标记
  if (chunk.trim() === "[DONE]") {
    return [buildSSE("message_stop", { type: "message_stop" })];
  }

  // 解析 JSON 响应
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(chunk);
  } catch {
    logger.warn("[GeminiCLI→Claude] Failed to parse response chunk", { chunk });
    return [];
  }

  let output = "";

  // 1. 发送 message_start（仅第一次）
  if (!geminiState.hasFirstResponse) {
    const responseId = (data.response as Record<string, unknown>)?.responseId || "msg_gemini_1";
    const modelVersion = (data.response as Record<string, unknown>)?.modelVersion || model;

    output += buildSSE("message_start", {
      type: "message_start",
      message: {
        id: responseId,
        type: "message",
        role: "assistant",
        content: [],
        model: modelVersion,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
      },
    });

    geminiState.hasFirstResponse = true;
  }

  // 2. 处理 response.candidates[0].content.parts[]
  const response = data.response as Record<string, unknown> | undefined;
  const candidates = response?.candidates as Array<Record<string, unknown>> | undefined;
  const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
  const parts = content?.parts as Array<Record<string, unknown>> | undefined;

  if (parts && Array.isArray(parts)) {
    for (const part of parts) {
      const partText = part.text as string | undefined;
      const functionCall = part.functionCall as Record<string, unknown> | undefined;
      const isThought = part.thought === true;

      // 处理文本内容
      if (partText) {
        if (isThought) {
          // === 推理内容（thinking）===
          if (geminiState.responseType === 2) {
            // 继续当前 thinking 块
            output += buildSSE("content_block_delta", {
              type: "content_block_delta",
              index: geminiState.responseIndex,
              delta: {
                type: "thinking_delta",
                thinking: partText,
              },
            });
          } else {
            // 从其他状态切换到 thinking
            // 先关闭之前的内容块
            if (geminiState.responseType !== 0) {
              output += buildSSE("content_block_stop", {
                type: "content_block_stop",
                index: geminiState.responseIndex,
              });
              geminiState.responseIndex = (geminiState.responseIndex || 0) + 1;
            }

            // 开始新的 thinking 块
            output += buildSSE("content_block_start", {
              type: "content_block_start",
              index: geminiState.responseIndex,
              content_block: {
                type: "thinking",
                thinking: "",
              },
            });

            output += buildSSE("content_block_delta", {
              type: "content_block_delta",
              index: geminiState.responseIndex,
              delta: {
                type: "thinking_delta",
                thinking: partText,
              },
            });

            geminiState.responseType = 2;
          }
        } else {
          // === 常规文本内容 ===
          if (geminiState.responseType === 1) {
            // 继续当前 text 块
            output += buildSSE("content_block_delta", {
              type: "content_block_delta",
              index: geminiState.responseIndex,
              delta: {
                type: "text_delta",
                text: partText,
              },
            });
          } else {
            // 从其他状态切换到 text
            // 先关闭之前的内容块
            if (geminiState.responseType !== 0) {
              output += buildSSE("content_block_stop", {
                type: "content_block_stop",
                index: geminiState.responseIndex,
              });
              geminiState.responseIndex = (geminiState.responseIndex || 0) + 1;
            }

            // 开始新的 text 块
            output += buildSSE("content_block_start", {
              type: "content_block_start",
              index: geminiState.responseIndex,
              content_block: {
                type: "text",
                text: "",
              },
            });

            output += buildSSE("content_block_delta", {
              type: "content_block_delta",
              index: geminiState.responseIndex,
              delta: {
                type: "text_delta",
                text: partText,
              },
            });

            geminiState.responseType = 1;
          }
        }
      }

      // 处理 functionCall → tool_use
      if (functionCall) {
        geminiState.usedTool = true;

        const funcName = (functionCall.name as string) || "";
        const args = (functionCall.args as Record<string, unknown>) || {};

        // 先关闭之前的内容块
        if (geminiState.responseType !== 0) {
          output += buildSSE("content_block_stop", {
            type: "content_block_stop",
            index: geminiState.responseIndex,
          });
          geminiState.responseIndex = (geminiState.responseIndex || 0) + 1;
        }

        // 生成工具调用 ID
        const toolCallID = `toolu_${funcName}_${Math.random().toString(36).substring(2, 10)}`;

        // 开始 tool_use 块
        output += buildSSE("content_block_start", {
          type: "content_block_start",
          index: geminiState.responseIndex,
          content_block: {
            type: "tool_use",
            id: toolCallID,
            name: funcName,
            input: {},
          },
        });

        // 发送 input_json_delta
        const argsJson = JSON.stringify(args);
        output += buildSSE("content_block_delta", {
          type: "content_block_delta",
          index: geminiState.responseIndex,
          delta: {
            type: "input_json_delta",
            partial_json: argsJson,
          },
        });

        // 立即关闭 tool_use 块（Gemini CLI 不分块发送）
        output += buildSSE("content_block_stop", {
          type: "content_block_stop",
          index: geminiState.responseIndex,
        });

        geminiState.responseIndex = (geminiState.responseIndex || 0) + 1;
        geminiState.responseType = 0; // 重置状态
      }
    }
  }

  // 3. 检查是否完成（根据 Gemini CLI 响应判断）
  // 注意：Gemini CLI 可能没有明确的完成标记，需要根据实际情况调整
  const finishReason = candidates?.[0]?.finishReason as string | undefined;
  if (finishReason || data.done === true) {
    // 关闭最后的内容块
    if (geminiState.responseType !== 0) {
      output += buildSSE("content_block_stop", {
        type: "content_block_stop",
        index: geminiState.responseIndex,
      });
    }

    // 发送 message_delta
    const stopReason = geminiState.usedTool ? "tool_use" : "end_turn";

    // 提取 usage 信息
    const usageMetadata = response?.usageMetadata as Record<string, unknown> | undefined;
    const inputTokens = (usageMetadata?.promptTokenCount as number) || 0;
    const outputTokens = (usageMetadata?.candidatesTokenCount as number) || 0;

    output += buildSSE("message_delta", {
      type: "message_delta",
      delta: {
        stop_reason: stopReason,
        stop_sequence: null,
      },
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
    });

    // 发送 message_stop
    output += buildSSE("message_stop", {
      type: "message_stop",
    });
  }

  return output ? [output] : [];
}

/**
 * 非流式响应转换：Gemini CLI → Claude
 *
 * @param ctx - Hono 上下文
 * @param model - 模型名称
 * @param originalRequest - 原始请求体
 * @param transformedRequest - 转换后的请求体
 * @param response - 完整的 Gemini CLI 响应体
 * @returns 转换后的 Claude 响应体
 */
export function transformGeminiCLINonStreamResponseToClaude(
  _ctx: Context,
  model: string,
  _originalRequest: Record<string, unknown>,
  _transformedRequest: Record<string, unknown>,
  response: Record<string, unknown>
): Record<string, unknown> {
  const geminiResponse = response.response as Record<string, unknown> | undefined;

  if (!geminiResponse) {
    logger.warn("[GeminiCLI→Claude] Missing response data in non-stream response");
    return response;
  }

  const candidates = geminiResponse.candidates as Array<Record<string, unknown>> | undefined;
  const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
  const parts = content?.parts as Array<Record<string, unknown>> | undefined;

  // 构建 Claude 响应
  const claudeContent: Array<{
    type: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }> = [];

  let usedTool = false;

  if (parts && Array.isArray(parts)) {
    for (const part of parts) {
      const partText = part.text as string | undefined;
      const functionCall = part.functionCall as Record<string, unknown> | undefined;
      const isThought = part.thought === true;

      // 处理文本内容
      if (partText) {
        if (isThought) {
          claudeContent.push({
            type: "thinking",
            thinking: partText,
          });
        } else {
          claudeContent.push({
            type: "text",
            text: partText,
          });
        }
      }

      // 处理 functionCall
      if (functionCall) {
        usedTool = true;
        const funcName = (functionCall.name as string) || "";
        const args = (functionCall.args as Record<string, unknown>) || {};
        const toolCallID = `toolu_${funcName}_${Math.random().toString(36).substring(2, 10)}`;

        claudeContent.push({
          type: "tool_use",
          id: toolCallID,
          name: funcName,
          input: args,
        });
      }
    }
  }

  // 提取 usage 信息
  const usageMetadata = geminiResponse.usageMetadata as Record<string, unknown> | undefined;
  const inputTokens = (usageMetadata?.promptTokenCount as number) || 0;
  const outputTokens = (usageMetadata?.candidatesTokenCount as number) || 0;

  // 构建 Claude 格式响应
  const responseId = (geminiResponse.responseId as string) || "msg_gemini_1";
  const modelVersion = (geminiResponse.modelVersion as string) || model;
  const stopReason = usedTool ? "tool_use" : "end_turn";

  return {
    id: responseId,
    type: "message",
    role: "assistant",
    model: modelVersion,
    content: claudeContent,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}
