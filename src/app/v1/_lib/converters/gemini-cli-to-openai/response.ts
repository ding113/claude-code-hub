/**
 * OpenAI → Gemini CLI 响应转换器
 *
 * 基于 CLIProxyAPI 的实现：
 * - /internal/translator/openai/gemini-cli/openai_gemini_response.go
 * - /internal/translator/openai/gemini/openai_gemini_response.go
 *
 * Gemini CLI 响应格式是在 Gemini 响应外包装 {response: ...} envelope
 */

import type { Context } from "hono";
import { logger } from "@/lib/logger";
import type { TransformState } from "../types";

/**
 * OpenAI → Gemini 转换状态
 */
interface OpenAIToGeminiState extends TransformState {
  toolCallsAccumulator?: Record<
    number,
    {
      id: string;
      name: string;
      arguments: string;
    }
  >;
  contentAccumulator?: string;
  isFirstChunk?: boolean;
}

/**
 * 映射 OpenAI finish reason 到 Gemini finish reason
 */
function mapOpenAIFinishReasonToGemini(openAIReason: string): string {
  switch (openAIReason) {
    case "stop":
      return "STOP";
    case "length":
      return "MAX_TOKENS";
    case "tool_calls":
      return "STOP"; // Gemini 没有专门的 tool_calls finish reason
    case "content_filter":
      return "SAFETY";
    default:
      return "STOP";
  }
}

/**
 * 解析 arguments 字符串为对象
 */
function parseArgsToMap(argsStr: string): Record<string, unknown> {
  const trimmed = argsStr.trim();
  if (!trimmed || trimmed === "{}") {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // 容错处理：如果解析失败，返回空对象
    logger.warn("[OpenAI→Gemini] Failed to parse arguments JSON", { argsStr: trimmed });
    return {};
  }
}

/**
 * 流式响应转换：OpenAI → Gemini CLI
 *
 * @param ctx - Hono 上下文
 * @param model - 模型名称
 * @param originalRequest - 原始请求体
 * @param transformedRequest - 转换后的请求体
 * @param chunk - 当前响应 chunk（JSON 字符串）
 * @param state - 状态对象
 * @returns 转换后的 Gemini CLI chunk 数组
 */
export function transformOpenAIStreamResponseToGeminiCLI(
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
      toolCallsAccumulator: {},
      contentAccumulator: "",
      isFirstChunk: true,
    } as OpenAIToGeminiState;
  }

  const geminiState = state as OpenAIToGeminiState;

  // 处理 [DONE] 标记
  if (chunk.trim() === "[DONE]") {
    return [];
  }

  // 移除 SSE 前缀
  let jsonChunk = chunk;
  if (jsonChunk.startsWith("data: ")) {
    jsonChunk = jsonChunk.substring(6).trim();
  }

  // 解析 JSON
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(jsonChunk);
  } catch {
    logger.warn("[OpenAI→GeminiCLI] Failed to parse response chunk", { chunk: jsonChunk });
    return [];
  }

  const results: string[] = [];

  // 处理 choices
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  if (!choices || !Array.isArray(choices)) {
    // 可能是 usage-only chunk
    if (data.usage) {
      const usage = data.usage as Record<string, unknown>;
      const geminiResponse = {
        response: {
          candidates: [],
          usageMetadata: {
            promptTokenCount: usage.prompt_tokens || 0,
            candidatesTokenCount: usage.completion_tokens || 0,
            totalTokenCount: usage.total_tokens || 0,
          },
          model: data.model || model,
        },
      };
      results.push(JSON.stringify(geminiResponse));
    }
    return results;
  }

  for (const choice of choices) {
    // 基础 Gemini 响应模板
    const geminiCandidate: Record<string, unknown> = {
      content: {
        parts: [],
        role: "model",
      },
      index: choice.index || 0,
    };

    const delta = choice.delta as Record<string, unknown> | undefined;
    if (!delta) {
      continue;
    }

    // 处理 role（仅第一个 chunk）
    if (delta.role && geminiState.isFirstChunk) {
      geminiState.isFirstChunk = false;
      const geminiResponse = {
        response: {
          candidates: [geminiCandidate],
          model: data.model || model,
        },
      };
      results.push(JSON.stringify(geminiResponse));
      continue;
    }

    // 处理 content delta
    if (delta.content && typeof delta.content === "string" && delta.content) {
      const contentText = delta.content;
      geminiState.contentAccumulator = (geminiState.contentAccumulator || "") + contentText;

      (geminiCandidate.content as Record<string, unknown>).parts = [
        {
          text: contentText,
        },
      ];

      const geminiResponse = {
        response: {
          candidates: [geminiCandidate],
          model: data.model || model,
        },
      };
      results.push(JSON.stringify(geminiResponse));
      continue;
    }

    // 处理 tool_calls delta
    if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
      for (const toolCall of delta.tool_calls) {
        const toolIndex = (toolCall.index as number) || 0;
        const toolID = (toolCall.id as string) || "";
        const toolType = (toolCall.type as string) || "";
        const func = toolCall.function as Record<string, unknown> | undefined;

        // 跳过非 function 类型
        if (toolType && toolType !== "function") {
          continue;
        }

        if (!func) {
          continue;
        }

        const functionName = (func.name as string) || "";
        const functionArgs = (func.arguments as string) || "";

        // 初始化累加器
        if (!geminiState.toolCallsAccumulator) {
          geminiState.toolCallsAccumulator = {};
        }

        if (!geminiState.toolCallsAccumulator[toolIndex]) {
          geminiState.toolCallsAccumulator[toolIndex] = {
            id: toolID,
            name: functionName,
            arguments: "",
          };
        }

        const acc = geminiState.toolCallsAccumulator[toolIndex];

        // 更新累加器
        if (toolID) {
          acc.id = toolID;
        }
        if (functionName) {
          acc.name = functionName;
        }
        if (functionArgs) {
          acc.arguments += functionArgs;
        }
      }

      // tool_calls delta 不立即输出，等待完成
      continue;
    }

    // 处理 finish_reason
    if (choice.finish_reason) {
      const geminiFinishReason = mapOpenAIFinishReasonToGemini(choice.finish_reason as string);
      geminiCandidate.finishReason = geminiFinishReason;

      // 如果有累加的 tool calls，现在输出它们
      if (
        geminiState.toolCallsAccumulator &&
        Object.keys(geminiState.toolCallsAccumulator).length > 0
      ) {
        const parts: Array<Record<string, unknown>> = [];

        for (const acc of Object.values(geminiState.toolCallsAccumulator)) {
          const argsMap = parseArgsToMap(acc.arguments);

          parts.push({
            functionCall: {
              name: acc.name,
              args: argsMap,
            },
          });
        }

        if (parts.length > 0) {
          (geminiCandidate.content as Record<string, unknown>).parts = parts;
        }

        // 清空累加器
        geminiState.toolCallsAccumulator = {};
      }

      const geminiResponse = {
        response: {
          candidates: [geminiCandidate],
          model: data.model || model,
        },
      };
      results.push(JSON.stringify(geminiResponse));
      continue;
    }

    // 处理 usage
    if (data.usage) {
      const usage = data.usage as Record<string, unknown>;
      const geminiResponse = {
        response: {
          candidates: [geminiCandidate],
          usageMetadata: {
            promptTokenCount: usage.prompt_tokens || 0,
            candidatesTokenCount: usage.completion_tokens || 0,
            totalTokenCount: usage.total_tokens || 0,
          },
          model: data.model || model,
        },
      };
      results.push(JSON.stringify(geminiResponse));
    }
  }

  return results;
}

/**
 * 非流式响应转换：OpenAI → Gemini CLI
 *
 * @param ctx - Hono 上下文
 * @param model - 模型名称
 * @param originalRequest - 原始请求体
 * @param transformedRequest - 转换后的请求体
 * @param response - 完整的 OpenAI 响应体
 * @returns 转换后的 Gemini CLI 响应体
 */
export function transformOpenAINonStreamResponseToGeminiCLI(
  _ctx: Context,
  model: string,
  _originalRequest: Record<string, unknown>,
  _transformedRequest: Record<string, unknown>,
  response: Record<string, unknown>
): Record<string, unknown> {
  // 基础 Gemini 响应结构
  const geminiResponse: Record<string, unknown> = {
    response: {
      candidates: [
        {
          content: {
            parts: [],
            role: "model",
          },
          index: 0,
        },
      ],
      model: response.model || model,
    },
  };

  // 处理 choices
  const choices = response.choices as Array<Record<string, unknown>> | undefined;
  if (choices && Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0];
    const message = choice.message as Record<string, unknown> | undefined;

    if (message) {
      const parts: Array<Record<string, unknown>> = [];

      // 处理 content
      if (message.content && typeof message.content === "string" && message.content) {
        parts.push({
          text: message.content,
        });
      }

      // 处理 tool_calls
      const toolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;
      if (toolCalls && Array.isArray(toolCalls)) {
        for (const toolCall of toolCalls) {
          if (toolCall.type === "function") {
            const func = toolCall.function as Record<string, unknown> | undefined;
            if (func) {
              const functionName = (func.name as string) || "";
              const functionArgs = (func.arguments as string) || "{}";
              const argsMap = parseArgsToMap(functionArgs);

              parts.push({
                functionCall: {
                  name: functionName,
                  args: argsMap,
                },
              });
            }
          }
        }
      }

      // 设置 parts
      if (parts.length > 0) {
        (
          (geminiResponse.response as Record<string, unknown>).candidates as Array<
            Record<string, unknown>
          >
        )[0].content = {
          parts,
          role: "model",
        };
      }

      // 处理 finish_reason
      if (choice.finish_reason) {
        const geminiFinishReason = mapOpenAIFinishReasonToGemini(choice.finish_reason as string);
        (
          (geminiResponse.response as Record<string, unknown>).candidates as Array<
            Record<string, unknown>
          >
        )[0].finishReason = geminiFinishReason;
      }

      // 设置 index
      (
        (geminiResponse.response as Record<string, unknown>).candidates as Array<
          Record<string, unknown>
        >
      )[0].index = choice.index || 0;
    }
  }

  // 处理 usage
  if (response.usage) {
    const usage = response.usage as Record<string, unknown>;
    (geminiResponse.response as Record<string, unknown>).usageMetadata = {
      promptTokenCount: usage.prompt_tokens || 0,
      candidatesTokenCount: usage.completion_tokens || 0,
      totalTokenCount: usage.total_tokens || 0,
    };
  }

  return geminiResponse;
}
