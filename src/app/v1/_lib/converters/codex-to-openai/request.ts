/**
 * Codex (Response API) → OpenAI Chat Completions 请求转换器
 *
 * 核心转换：
 * - instructions → system message
 * - input[] → messages[]
 * - input_text → text content (user)
 * - output_text → text content (assistant)
 * - input_image → image content
 * - function_call → tool_calls (assistant)
 * - function_call_output → tool result (tool role)
 * - tools[].parameters → tools[].function.parameters
 * - max_output_tokens → max_tokens
 */

import { logger } from "@/lib/logger";

/**
 * Response API 格式的请求体接口（简化类型定义）
 */
interface ResponseAPIRequest {
  model?: string;
  instructions?: string;
  input?: Array<{
    type?: string;
    role?: string;
    content?: Array<{
      type: string;
      text?: string;
      image_url?: string;
      url?: string;
    }>;
    call_id?: string;
    name?: string;
    arguments?: string | Record<string, unknown>;
    output?: string;
  }>;
  tools?: Array<{
    type?: string;
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
    parametersJsonSchema?: Record<string, unknown>;
  }>;
  tool_choice?: string | { type: string; function?: { name: string } };
  max_output_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
}

/**
 * OpenAI Chat Completions 格式的请求体接口（简化类型定义）
 */
interface OpenAIChatCompletionRequest {
  model: string;
  messages: Array<{
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
  tool_choice?:
    | string
    | {
        type: string;
        function?: {
          name: string;
        };
      };
  max_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
}

/**
 * 转换 Response API 请求为 OpenAI Chat Completions 格式
 *
 * @param model - 模型名称
 * @param request - Response API 格式的请求体
 * @param stream - 是否为流式请求
 * @returns OpenAI Chat Completions 格式的请求体
 */
export function transformCodexRequestToOpenAI(
  model: string,
  request: Record<string, unknown>,
  stream: boolean
): Record<string, unknown> {
  const req = request as ResponseAPIRequest;

  // 基础 OpenAI 请求结构
  const output: OpenAIChatCompletionRequest = {
    model,
    messages: [],
    max_tokens: 32000,
    stream,
  };

  logger.debug("[Codex→OpenAI] Starting request transformation", {
    model,
    stream,
    hasInstructions: !!req.instructions,
    inputCount: req.input?.length || 0,
    hasTools: !!req.tools,
    toolsCount: req.tools?.length || 0,
  });

  // 1. 处理 instructions（转换为 system message）
  if (req.instructions && typeof req.instructions === "string") {
    if (req.instructions) {
      output.messages.push({
        role: "system",
        content: req.instructions,
      });
    }
  }

  // 如果没有 instructions，尝试从 input 中提取 system 消息
  if (!req.instructions && req.input && Array.isArray(req.input)) {
    for (const item of req.input) {
      if (item.role?.toLowerCase() === "system") {
        const parts: string[] = [];
        if (item.content && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part.text) {
              parts.push(part.text);
            }
          }
        }
        const systemText = parts.join("\n");
        if (systemText) {
          output.messages.push({
            role: "system",
            content: systemText,
          });
          break;
        }
      }
    }
  }

  // 2. 处理 input 数组
  if (req.input && Array.isArray(req.input)) {
    for (const item of req.input) {
      // 跳过 system 消息（已处理）
      if (item.role?.toLowerCase() === "system") {
        continue;
      }

      const itemType = item.type || (item.role ? "message" : "");

      switch (itemType) {
        case "message": {
          // 处理 message 类型
          let role = "";
          const contentParts: Array<{
            type: string;
            text?: string;
            image_url?: {
              url: string;
              detail?: string;
            };
          }> = [];
          let hasImage = false;

          if (item.content && Array.isArray(item.content)) {
            for (const part of item.content) {
              const partType = part.type;

              switch (partType) {
                case "input_text":
                  if (part.text) {
                    contentParts.push({ type: "text", text: part.text });
                    role = "user";
                  }
                  break;

                case "output_text":
                  if (part.text) {
                    contentParts.push({ type: "text", text: part.text });
                    role = "assistant";
                  }
                  break;

                case "input_image": {
                  const imageUrl = part.image_url || part.url;
                  if (imageUrl) {
                    contentParts.push({
                      type: "image_url",
                      image_url: {
                        url: imageUrl,
                        detail: "auto",
                      },
                    });
                    hasImage = true;
                    if (!role) {
                      role = "user";
                    }
                  }
                  break;
                }
              }
            }
          }

          // 如果没有从 content 类型推断出 role，使用 item.role
          if (!role) {
            const itemRole = item.role || "user";
            role = ["user", "assistant", "system"].includes(itemRole) ? itemRole : "user";
          }

          // 构建消息
          if (contentParts.length > 0) {
            if (contentParts.length === 1 && !hasImage) {
              // 单个文本内容时使用简化格式
              output.messages.push({
                role,
                content: contentParts[0].text || "",
              });
            } else {
              // 多内容或包含图片时使用数组格式
              output.messages.push({
                role,
                content: contentParts,
              });
            }
          }
          break;
        }

        case "function_call": {
          // 转换为 assistant tool_calls
          const callID = item.call_id || "";
          const name = item.name || "";
          let argumentsStr = "";

          if (item.arguments) {
            if (typeof item.arguments === "string") {
              argumentsStr = item.arguments;
            } else {
              argumentsStr = JSON.stringify(item.arguments);
            }
          }

          output.messages.push({
            role: "assistant",
            content: null as unknown as string, // OpenAI 允许 null
            tool_calls: [
              {
                id: callID,
                type: "function",
                function: {
                  name,
                  arguments: argumentsStr,
                },
              },
            ],
          });
          break;
        }

        case "function_call_output": {
          // 转换为 tool role 消息
          const outputStr = item.output || "";
          const callID = item.call_id || "";

          output.messages.push({
            role: "tool",
            content: outputStr,
            tool_call_id: callID,
          });
          break;
        }
      }
    }
  }

  // 3. 转换 tools（parameters → function.parameters）
  if (req.tools && Array.isArray(req.tools) && req.tools.length > 0) {
    output.tools = [];

    for (const tool of req.tools) {
      const openAITool: {
        type: string;
        function: {
          name: string;
          description?: string;
          parameters: Record<string, unknown>;
        };
      } = {
        type: "function",
        function: {
          name: tool.name || "",
          parameters: tool.parameters || tool.parametersJsonSchema || {},
        },
      };

      if (tool.description) {
        openAITool.function.description = tool.description;
      }

      output.tools.push(openAITool);
    }
  }

  // 4. 转换 tool_choice
  if (req.tool_choice) {
    if (typeof req.tool_choice === "string") {
      switch (req.tool_choice) {
        case "auto":
          output.tool_choice = "auto";
          break;
        case "none":
          output.tool_choice = "none";
          break;
        case "required":
          output.tool_choice = "required";
          break;
      }
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

  // 5. 转换 max_output_tokens
  if (req.max_output_tokens) {
    output.max_tokens = req.max_output_tokens;
  }

  logger.debug("[Codex→OpenAI] Request transformation completed", {
    messageCount: output.messages.length,
    hasTools: !!output.tools,
    toolsCount: output.tools?.length || 0,
    maxTokens: output.max_tokens,
  });

  return output as unknown as Record<string, unknown>;
}
