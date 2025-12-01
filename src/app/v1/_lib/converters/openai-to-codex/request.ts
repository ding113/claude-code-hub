/**
 * OpenAI Chat Completions → Codex Response API 请求转换器
 *
 * 基于 CLIProxyAPI 的实现：
 * - internal/translator/codex/openai/responses/codex_openai-responses_request.go
 * - internal/misc/codex_instructions.go
 *
 * 核心转换：
 * - messages[] → input[] (message 类型)
 * - system messages → instructions (需要检测并注入强制 prompt)
 * - messages[].content.text → input_text / output_text
 * - messages[].content.image_url → input_image
 * - messages[].tool_calls → function_call
 * - tool results → function_call_output
 * - tools[] → tools[] (function.parameters → parameters)
 * - ❌ 删除不支持的参数：max_tokens, temperature, top_p 等
 * - 强制设置：stream=true, store=false, parallel_tool_calls=true
 */

import { logger } from "@/lib/logger";
import { getDefaultInstructions } from "../../codex/constants/codex-instructions";

/**
 * OpenAI Chat Completions 请求体接口（简化类型定义）
 */
interface OpenAIChatCompletionRequest {
  model?: string;
  messages?: Array<{
    role: string;
    content?:
      | string
      | Array<{
          type: string;
          text?: string;
          image_url?: {
            url: string;
            detail?: string;
          };
        }>;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string | Record<string, unknown>;
      };
    }>;
    tool_call_id?: string;
    name?: string;
  }>;
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }>;
  tool_choice?:
    | string
    | {
        type: string;
        function?: {
          name: string;
        };
      };
  max_tokens?: number;
  max_output_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  [key: string]: unknown;
}

/**
 * Codex Response API 格式的请求体接口（简化类型定义）
 */
interface CodexRequest {
  model: string;
  stream: boolean;
  store: boolean;
  parallel_tool_calls: boolean;
  include: string[];
  instructions?: string;
  input: Array<{
    type: string;
    role?: string;
    content?: Array<{
      type: string;
      text?: string;
      image_url?: string;
    }>;
    call_id?: string;
    name?: string;
    arguments?: string | Record<string, unknown>;
    output?: string;
  }>;
  tools?: Array<{
    type: string;
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
  tool_choice?: string | { type: string; function?: { name: string } };
  [key: string]: unknown;
}

/**
 * 转换 OpenAI Chat Completions 请求为 Codex Response API 格式
 *
 * @param model - 模型名称
 * @param request - OpenAI Chat Completions 格式的请求体
 * @param stream - 是否为流式请求
 * @returns Codex Response API 格式的请求体
 */
export function transformOpenAIRequestToCodex(
  model: string,
  request: Record<string, unknown>,
  stream: boolean
): Record<string, unknown> {
  const req = request as OpenAIChatCompletionRequest;

  // 基础 Codex 请求结构（参考 CLIProxyAPI:13-24）
  const output: CodexRequest = {
    model,
    stream: true, // 强制 stream: true
    store: false, // 强制 store: false
    parallel_tool_calls: true, // 强制启用并行工具调用
    include: ["reasoning.encrypted_content"], // 包含推理内容
    input: [],
  };

  logger.debug("[OpenAI→Codex] Starting request transformation", {
    model,
    stream,
    messageCount: req.messages?.length || 0,
    hasTools: !!req.tools,
    toolsCount: req.tools?.length || 0,
  });

  // 步骤 1: 提取 system messages 作为 instructions
  const systemMessages = req.messages?.filter((m) => m.role === "system") || [];
  let extractedInstructions = "";

  if (systemMessages.length > 0) {
    extractedInstructions = systemMessages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .filter((text) => text.trim())
      .join("\n\n");
  }

  logger.debug("[OpenAI→Codex] Extracted instructions", {
    hasInstructions: !!extractedInstructions,
    instructionsLength: extractedInstructions.length,
  });

  // 步骤 2: 转换 messages → input（跳过 system messages）
  const nonSystemMessages = req.messages?.filter((m) => m.role !== "system") || [];
  let firstUserMessageIndex = -1;
  let processedFirstMessage = false;

  for (let i = 0; i < nonSystemMessages.length; i++) {
    const message = nonSystemMessages[i];
    const role = message.role; // "user" | "assistant" | "tool"

    // 处理 tool 角色的消息（tool result）
    if (role === "tool") {
      const toolResultContent = typeof message.content === "string" ? message.content : "";
      const toolCallId = message.tool_call_id || "";

      output.input.push({
        type: "function_call_output",
        call_id: toolCallId,
        output: toolResultContent,
      });
      continue;
    }

    // 处理 assistant 消息的 tool_calls
    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        let args: string | Record<string, unknown> = {};

        if (typeof toolCall.function.arguments === "string") {
          // Codex 接受字符串格式的 arguments
          args = toolCall.function.arguments;
        } else {
          args = toolCall.function.arguments as Record<string, unknown>;
        }

        output.input.push({
          type: "function_call",
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: args,
        });
      }
      continue; // 跳过 content 处理，因为有 tool_calls 时 content 通常为空
    }

    // 处理普通消息内容
    const content = message.content;

    // 记录第一条用户消息的位置
    if (role === "user" && firstUserMessageIndex === -1) {
      firstUserMessageIndex = output.input.length;
    }

    if (typeof content === "string") {
      // 简单文本内容
      const textType = role === "assistant" ? "output_text" : "input_text";

      // 如果是第一条用户消息且有 system messages，将其前置
      if (role === "user" && !processedFirstMessage && extractedInstructions) {
        // 将 system messages 转为 user 角色，前置到第一条用户消息
        output.input.push({
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: extractedInstructions, // 用户的 system message
            },
            {
              type: "input_text",
              text: content, // 用户的第一条消息
            },
          ],
        });
        processedFirstMessage = true;
      } else {
        // 正常消息（无 system message 或已处理过）
        output.input.push({
          type: "message",
          role,
          content: [
            {
              type: textType,
              text: content,
            },
          ],
        });
      }
    } else if (Array.isArray(content)) {
      // 多模态内容
      const contentParts: Array<{
        type: string;
        text?: string;
        image_url?: string;
      }> = [];

      for (const part of content) {
        if (part.type === "text") {
          const textType = role === "assistant" ? "output_text" : "input_text";
          contentParts.push({ type: textType, text: part.text || "" });
        } else if (part.type === "image_url") {
          const imageUrl = part.image_url?.url || "";
          if (imageUrl) {
            contentParts.push({
              type: "input_image",
              image_url: imageUrl, // Codex 使用 image_url 字段
            });
          }
        }
      }

      // 如果是第一条用户消息且有 system messages，将其前置
      if (role === "user" && !processedFirstMessage && extractedInstructions) {
        // 将 system messages 转为 user 角色，前置到多模态消息
        const injectedContent = [
          {
            type: "input_text",
            text: extractedInstructions, // 用户的 system message
          },
          ...contentParts, // 原始多模态内容
        ];

        output.input.push({
          type: "message",
          role: "user",
          content: injectedContent,
        });
        processedFirstMessage = true;
      } else {
        // 正常多模态消息（无 system message 或已处理过）
        if (contentParts.length > 0) {
          output.input.push({
            type: "message",
            role,
            content: contentParts,
          });
        }
      }
    }
  }

  // 步骤 8: 设置 instructions 字段（参考 CLIProxyAPI:codex_openai-responses_request.go:101）
  // ⚠️ 关键修复：Codex API 强制要求此字段必须是完整的官方 prompt
  // 对于 Codex 格式，始终使用官方完整 instructions（Codex 供应商强制校验）
  // 用户的自定义 instructions 已经通过消息注入处理（步骤 4）
  // 参考：官方 Codex CLI 客户端响应体中的 instructions 字段（约 4000+ 字完整 prompt）
  output.instructions = getDefaultInstructions(model);

  // 步骤 5: 转换 tools
  if (req.tools && Array.isArray(req.tools)) {
    output.tools = req.tools.map((tool) => ({
      type: "function",
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters || {}, // Codex 使用 parameters 而非 input_schema
    }));
  }

  // 步骤 6: 转换 tool_choice
  if (req.tool_choice) {
    if (typeof req.tool_choice === "string") {
      // "auto", "required", "none"
      output.tool_choice = req.tool_choice;
    } else if (typeof req.tool_choice === "object") {
      const tc = req.tool_choice as { type: string; function?: { name: string } };
      if (tc.type === "function" && tc.function?.name) {
        output.tool_choice = {
          type: "function",
          function: {
            name: tc.function.name,
          },
        };
      }
    }
  }

  // 步骤 7: ❌ 删除不支持的参数（参考 CLIProxyAPI:20-24）
  // Codex 不接受这些参数，必须删除（而非转换）：
  // - max_tokens, max_output_tokens, max_completion_tokens
  // - temperature, top_p
  // 这些参数不应该出现在 output 中

  logger.debug("[OpenAI→Codex] Request transformation completed", {
    inputCount: output.input.length,
    hasInstructions: !!output.instructions,
    instructionsPreview: output.instructions ? `${output.instructions.slice(0, 100)}...` : "N/A",
    hasTools: !!output.tools,
    toolsCount: output.tools?.length || 0,
    systemMessagesHandled: !!extractedInstructions && processedFirstMessage,
  });

  return output as unknown as Record<string, unknown>;
}
