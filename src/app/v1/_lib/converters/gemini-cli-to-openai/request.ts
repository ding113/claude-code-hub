/**
 * Gemini CLI → OpenAI Compatible API 请求转换器
 *
 * 基于 CLIProxyAPI 的实现：
 * - /internal/translator/openai/gemini-cli/openai_gemini_request.go
 * - /internal/translator/openai/gemini/openai_gemini_request.go
 *
 * Gemini CLI 请求格式是在 Gemini 格式外包装了一层 envelope：
 * {
 *   "model": "gemini-2.0-flash",
 *   "request": {
 *     // Gemini 格式的请求内容
 *     "contents": [...],
 *     "generationConfig": {...},
 *     ...
 *   }
 * }
 *
 * 转换策略：
 * 1. 解包 envelope，提取 request 字段
 * 2. 将 Gemini 格式转换为 OpenAI Chat Completions 格式
 * 3. 处理 systemInstruction, contents, tools, generationConfig 等字段
 */

import { randomBytes } from "node:crypto";
import { logger } from "@/lib/logger";

/**
 * Gemini CLI 格式的请求体接口
 */
interface GeminiCLIRequest {
  model?: string;
  request?: {
    systemInstruction?: {
      role?: string;
      parts?: Array<{
        text?: string;
      }>;
    };
    contents?: Array<{
      role?: string;
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
        functionCall?: {
          name?: string;
          args?: Record<string, unknown>;
        };
        functionResponse?: {
          name?: string;
          response?: Record<string, unknown>;
        };
      }>;
    }>;
    tools?: Array<{
      functionDeclarations?: Array<{
        name?: string;
        description?: string;
        parametersJsonSchema?: Record<string, unknown>;
      }>;
    }>;
    generationConfig?: {
      temperature?: number;
      topP?: number;
      topK?: number;
      maxOutputTokens?: number;
      stopSequences?: string[];
      thinkingConfig?: {
        include_thoughts?: boolean;
        thinkingBudget?: number;
      };
    };
  };
  [key: string]: unknown;
}

/**
 * OpenAI Compatible API 格式的请求体接口
 */
interface OpenAIRequest {
  model: string;
  messages: Array<{
    role: string;
    content:
      | string
      | Array<{
          type: string;
          text?: string;
          image_url?: {
            url: string;
          };
        }>;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
    tool_call_id?: string;
  }>;
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
    };
  }>;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  stop?: string[];
  reasoning_effort?: string;
  stream?: boolean;
  [key: string]: unknown;
}

/**
 * 生成工具调用 ID
 */
function generateToolCallID(): string {
  const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(24);
  let result = "call_";
  for (let i = 0; i < 24; i++) {
    result += letters[bytes[i] % letters.length];
  }
  return result;
}

/**
 * 转换 Gemini CLI 请求为 OpenAI Compatible API 格式
 *
 * @param model - 模型名称
 * @param request - Gemini CLI 格式的请求体
 * @param stream - 是否为流式请求
 * @returns OpenAI Compatible API 格式的请求体
 */
export function transformGeminiCLIRequestToOpenAI(
  model: string,
  request: Record<string, unknown>,
  stream: boolean
): Record<string, unknown> {
  const req = request as GeminiCLIRequest;

  // 解包 envelope，提取 request 字段
  const geminiRequest = req.request;
  if (!geminiRequest) {
    logger.warn("[GeminiCLI→OpenAI] Missing request field in Gemini CLI envelope");
    return { model, messages: [], stream };
  }

  // 基础 OpenAI 请求结构
  const output: OpenAIRequest = {
    model,
    messages: [],
    stream,
  };

  logger.debug("[GeminiCLI→OpenAI] Starting request transformation", {
    model,
    stream,
    hasSystemInstruction: !!geminiRequest.systemInstruction,
    contentsCount: geminiRequest.contents?.length || 0,
    hasTools: !!geminiRequest.tools,
  });

  // 用于追踪工具调用 ID（用于匹配 functionResponse）
  const toolCallIDs: string[] = [];

  // 处理 systemInstruction → system message
  if (
    geminiRequest.systemInstruction?.parts &&
    Array.isArray(geminiRequest.systemInstruction.parts)
  ) {
    const systemTexts: string[] = [];
    for (const part of geminiRequest.systemInstruction.parts) {
      if (part.text) {
        systemTexts.push(part.text);
      }
    }

    if (systemTexts.length > 0) {
      output.messages.push({
        role: "system",
        content: systemTexts.join("\n"),
      });
    }
  }

  // 处理 contents → messages
  if (geminiRequest.contents && Array.isArray(geminiRequest.contents)) {
    for (const content of geminiRequest.contents) {
      let role = content.role || "user";

      // 角色映射：model → assistant
      if (role === "model") {
        role = "assistant";
      }

      const parts = content.parts;
      if (!parts || !Array.isArray(parts)) {
        continue;
      }

      // 分类 parts
      const textParts: string[] = [];
      const contentParts: Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
      }> = [];
      const toolCalls: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }> = [];
      let hasFunctionResponse = false;

      for (const part of parts) {
        // 处理 text
        if (part.text) {
          textParts.push(part.text);
          contentParts.push({
            type: "text",
            text: part.text,
          });
        }

        // 处理 inlineData (images)
        if (part.inlineData) {
          const mimeType = part.inlineData.mimeType || "application/octet-stream";
          const data = part.inlineData.data || "";
          const imageURL = `data:${mimeType};base64,${data}`;

          contentParts.push({
            type: "image_url",
            image_url: { url: imageURL },
          });
        }

        // 处理 functionCall → tool_calls
        if (part.functionCall) {
          const funcName = part.functionCall.name || "";
          const args = part.functionCall.args || {};
          const toolCallID = generateToolCallID();
          toolCallIDs.push(toolCallID);

          toolCalls.push({
            id: toolCallID,
            type: "function",
            function: {
              name: funcName,
              arguments: JSON.stringify(args),
            },
          });
        }

        // 处理 functionResponse → tool message
        if (part.functionResponse) {
          hasFunctionResponse = true;
          const funcName = part.functionResponse.name || "";
          const response = part.functionResponse.response || {};

          // 提取响应内容
          let responseContent = "";
          if (typeof response.result !== "undefined") {
            responseContent =
              typeof response.result === "string"
                ? response.result
                : JSON.stringify(response.result);
          } else {
            responseContent = JSON.stringify(response);
          }

          // 匹配工具调用 ID（简单策略：使用最后一个）
          const toolCallID =
            toolCallIDs.length > 0 ? toolCallIDs[toolCallIDs.length - 1] : `call_${funcName}`;

          // 创建 tool 消息
          output.messages.push({
            role: "tool",
            tool_call_id: toolCallID,
            content: responseContent,
          });
        }
      }

      // 构建消息
      if (hasFunctionResponse) {
        // functionResponse 已经作为独立消息添加
        continue;
      }

      if (toolCalls.length > 0) {
        // Assistant 消息 + tool_calls
        output.messages.push({
          role: "assistant",
          content: "", // OpenAI 要求 tool_calls 时 content 为空或 null
          tool_calls: toolCalls,
        });
      } else if (contentParts.length > 0) {
        // 普通消息
        if (contentParts.length === 1 && contentParts[0].type === "text") {
          // 简化格式：纯文本
          output.messages.push({
            role,
            content: contentParts[0].text || "",
          });
        } else {
          // 数组格式：多内容或包含图片
          output.messages.push({
            role,
            content: contentParts,
          });
        }
      }
    }
  }

  // 处理 tools → tools
  if (geminiRequest.tools && Array.isArray(geminiRequest.tools) && geminiRequest.tools.length > 0) {
    const toolDeclarations = geminiRequest.tools[0]?.functionDeclarations;

    if (toolDeclarations && Array.isArray(toolDeclarations) && toolDeclarations.length > 0) {
      output.tools = [];

      for (const funcDecl of toolDeclarations) {
        output.tools.push({
          type: "function",
          function: {
            name: funcDecl.name || "",
            description: funcDecl.description,
            parameters: funcDecl.parametersJsonSchema || {},
          },
        });
      }
    }
  }

  // 处理 generationConfig
  if (geminiRequest.generationConfig) {
    const genConfig = geminiRequest.generationConfig;

    if (typeof genConfig.temperature === "number") {
      output.temperature = genConfig.temperature;
    }
    if (typeof genConfig.topP === "number") {
      output.top_p = genConfig.topP;
    }
    if (typeof genConfig.topK === "number") {
      output.top_k = genConfig.topK;
    }
    if (typeof genConfig.maxOutputTokens === "number") {
      output.max_tokens = genConfig.maxOutputTokens;
    }
    if (genConfig.stopSequences && Array.isArray(genConfig.stopSequences)) {
      output.stop = genConfig.stopSequences;
    }

    // 处理 thinkingConfig → reasoning_effort
    if (genConfig.thinkingConfig) {
      const thinkingBudget = genConfig.thinkingConfig.thinkingBudget;
      const includeThoughts = genConfig.thinkingConfig.include_thoughts ?? true;

      if (!includeThoughts || thinkingBudget === 0) {
        output.reasoning_effort = "none";
      } else if (thinkingBudget === -1) {
        output.reasoning_effort = "auto";
      } else if (typeof thinkingBudget === "number") {
        // 映射 token budget 到 effort level
        if (thinkingBudget <= 1024) {
          output.reasoning_effort = "low";
        } else if (thinkingBudget <= 8192) {
          output.reasoning_effort = "medium";
        } else {
          output.reasoning_effort = "high";
        }
      }
    }
  }

  logger.debug("[GeminiCLI→OpenAI] Request transformation completed", {
    messageCount: output.messages.length,
    hasTools: !!output.tools,
    toolsCount: output.tools?.length || 0,
    hasReasoning: !!output.reasoning_effort,
  });

  return output as unknown as Record<string, unknown>;
}
