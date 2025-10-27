/**
 * OpenAI Chat Completions → Claude Messages API 请求转换器
 *
 * 核心转换：
 * - messages[] → messages[]（role 保持一致）
 * - system 消息提取到顶级 system 字段
 * - messages[].content.text → content.text
 * - messages[].content.image_url → image（data URL 或 URL）
 * - messages[].tool_calls → 转换为 assistant content 中的 tool_use
 * - tools[] → tools[]（function.parameters → input_schema）
 * - tool_choice → tool_choice
 * - max_tokens → max_tokens
 */

import { logger } from "@/lib/logger";

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
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  [key: string]: unknown;
}

/**
 * Claude Messages API 格式的请求体接口（简化类型定义）
 */
interface ClaudeRequest {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: string;
    content:
      | string
      | Array<{
          type: string;
          text?: string;
          source?: {
            type: string;
            media_type?: string;
            data?: string;
            url?: string;
          };
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
          tool_use_id?: string;
          content?: string | Array<unknown>;
        }>;
  }>;
  system?: string | Array<{ type: string; text: string }>;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
  }>;
  tool_choice?: { type: string; name?: string };
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  [key: string]: unknown;
}

/**
 * 转换 OpenAI Chat Completions 请求为 Claude Messages API 格式
 *
 * @param model - 模型名称
 * @param request - OpenAI Chat Completions 格式的请求体
 * @param stream - 是否为流式请求
 * @returns Claude Messages API 格式的请求体
 */
export function transformOpenAIRequestToClaude(
  model: string,
  request: Record<string, unknown>,
  stream: boolean
): Record<string, unknown> {
  const req = request as OpenAIChatCompletionRequest;

  // 基础 Claude 请求结构
  const output: ClaudeRequest = {
    model,
    max_tokens: req.max_tokens || 32000,
    messages: [],
    stream,
  };

  logger.debug("[OpenAI→Claude] Starting request transformation", {
    model,
    stream,
    messageCount: req.messages?.length || 0,
    hasTools: !!req.tools,
    toolsCount: req.tools?.length || 0,
  });

  // 1. 提取 system 消息（从 messages 中提取 role: "system"）
  const systemMessages = req.messages?.filter((m) => m.role === "system") || [];
  if (systemMessages.length > 0) {
    const systemText = systemMessages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");

    if (systemText) {
      output.system = systemText;
    }
  }

  // 2. 转换 messages（跳过 system 消息）
  const nonSystemMessages = req.messages?.filter((m) => m.role !== "system") || [];
  for (const message of nonSystemMessages) {
    const role = message.role; // "user" | "assistant" | "tool"
    const content = message.content;

    // 处理 tool 角色的消息（tool result）
    if (role === "tool") {
      const toolResultContent = typeof content === "string" ? content : "";
      const toolCallId = message.tool_call_id || "";

      output.messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolCallId,
            content: toolResultContent,
          },
        ],
      });
      continue;
    }

    // 处理 assistant 消息的 tool_calls
    // OpenAI 规范：当有 tool_calls 时，content 通常为 null 或空字符串
    // Claude 规范：tool_use 和 text 可以在同一个 content 数组中
    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      const toolUseParts: Array<{
        type: string;
        id: string;
        name: string;
        input: Record<string, unknown>;
      }> = [];

      for (const toolCall of message.tool_calls) {
        let args: Record<string, unknown> = {};

        if (typeof toolCall.function.arguments === "string") {
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch {
            // 解析失败时使用空对象
          }
        } else {
          args = toolCall.function.arguments as Record<string, unknown>;
        }

        toolUseParts.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: args,
        });
      }

      if (toolUseParts.length > 0) {
        output.messages.push({
          role: "assistant",
          content: toolUseParts,
        });
      }
      continue; // 跳过 content 处理，因为有 tool_calls 时 content 通常为空
    }

    // 处理不同的 content 格式（仅当没有 tool_calls 时）
    if (typeof content === "string") {
      // 简单文本内容
      output.messages.push({
        role,
        content,
      });
    } else if (Array.isArray(content)) {
      // 多模态内容
      const contentParts: Array<{
        type: string;
        text?: string;
        source?: {
          type: string;
          media_type?: string;
          data?: string;
          url?: string;
        };
      }> = [];

      for (const part of content) {
        if (part.type === "text") {
          contentParts.push({ type: "text", text: part.text || "" });
        } else if (part.type === "image_url") {
          const imageUrl = part.image_url?.url || "";

          if (imageUrl.startsWith("data:")) {
            // 解析 data URL
            const trimmed = imageUrl.substring(5); // 移除 "data:"
            const [mediaType, base64Data] = trimmed.split(";base64,");

            if (base64Data) {
              contentParts.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType || "application/octet-stream",
                  data: base64Data,
                },
              });
            }
          } else {
            // URL
            contentParts.push({
              type: "image",
              source: {
                type: "url",
                url: imageUrl,
              },
            });
          }
        }
      }

      if (contentParts.length > 0) {
        output.messages.push({
          role,
          content: contentParts,
        });
      }
    }
  }

  // 3. 转换 tools
  if (req.tools && Array.isArray(req.tools)) {
    output.tools = req.tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters || {},
    }));
  }

  // 4. 转换 tool_choice
  if (req.tool_choice) {
    if (typeof req.tool_choice === "string") {
      switch (req.tool_choice) {
        case "auto":
          output.tool_choice = { type: "auto" };
          break;
        case "required":
          output.tool_choice = { type: "any" };
          break;
        case "none":
          // 不设置 tool_choice
          break;
      }
    } else if (typeof req.tool_choice === "object") {
      const tc = req.tool_choice as { type: string; function?: { name: string } };
      if (tc.type === "function" && tc.function?.name) {
        output.tool_choice = {
          type: "tool",
          name: tc.function.name,
        };
      }
    }
  }

  // 5. 传递其他参数
  if (req.temperature !== undefined) {
    output.temperature = req.temperature;
  }

  if (req.top_p !== undefined) {
    output.top_p = req.top_p;
  }

  logger.debug("[OpenAI→Claude] Request transformation completed", {
    messageCount: output.messages.length,
    hasSystem: !!output.system,
    hasTools: !!output.tools,
    toolsCount: output.tools?.length || 0,
    maxTokens: output.max_tokens,
  });

  return output as unknown as Record<string, unknown>;
}
