/**
 * Codex (Response API) → Claude Messages API 请求转换器
 *
 * 基于 CLIProxyAPI 的实现：
 * - /internal/translator/claude/openai/responses/claude_openai-responses_request.go
 *
 * 核心转换：
 * - instructions → system message (作为 user role)
 * - input[] → messages[]
 * - input_text → text content (user)
 * - output_text → text content (assistant)
 * - input_image → image content
 * - function_call → tool_use (assistant)
 * - function_call_output → tool_result (user)
 * - tools[].parameters → tools[].input_schema
 * - max_output_tokens → max_tokens
 * - reasoning.effort → thinking.budget_tokens
 */

import { randomBytes } from "node:crypto";
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
  reasoning?: {
    effort?: string;
  };
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
        }>;
  }>;
  system?: string | Array<{ type: string; text: string }>;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
  }>;
  tool_choice?: { type: string; name?: string };
  thinking?: {
    type: string;
    budget_tokens?: number;
  };
  stream?: boolean;
  metadata?: {
    user_id: string;
  };
  [key: string]: unknown;
}

/**
 * 生成随机工具调用 ID
 */
function generateToolCallID(): string {
  const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(24);
  let result = "toolu_";
  for (let i = 0; i < 24; i++) {
    result += letters[bytes[i] % letters.length];
  }
  return result;
}

/**
 * 生成用户 ID（基于 account 和 session）
 */
function generateUserID(): string {
  // 简化实现：使用随机 UUID
  const account = randomBytes(16).toString("hex");
  const session = randomBytes(16).toString("hex");
  const user = randomBytes(16).toString("hex");
  return `user_${user}_account_${account}_session_${session}`;
}

/**
 * 转换 Response API 请求为 Claude Messages API 格式
 *
 * @param model - 模型名称
 * @param request - Response API 格式的请求体
 * @param stream - 是否为流式请求
 * @returns Claude Messages API 格式的请求体
 */
export function transformCodexRequestToClaude(
  model: string,
  request: Record<string, unknown>,
  stream: boolean
): Record<string, unknown> {
  const req = request as ResponseAPIRequest;

  // 基础 Claude 请求结构
  const output: ClaudeRequest = {
    model,
    max_tokens: 32000,
    messages: [],
    metadata: {
      user_id: generateUserID(),
    },
    stream,
  };

  logger.debug("[Codex→Claude] Starting request transformation", {
    model,
    stream,
    hasInstructions: !!req.instructions,
    inputCount: req.input?.length || 0,
    hasTools: !!req.tools,
    toolsCount: req.tools?.length || 0,
  });

  // 转换 reasoning.effort → thinking.budget_tokens
  if (req.reasoning?.effort) {
    const effort = req.reasoning.effort;
    output.thinking = { type: "enabled" };

    switch (effort) {
      case "none":
        output.thinking.type = "disabled";
        break;
      case "minimal":
        output.thinking.budget_tokens = 1024;
        break;
      case "low":
        output.thinking.budget_tokens = 4096;
        break;
      case "medium":
        output.thinking.budget_tokens = 8192;
        break;
      case "high":
        output.thinking.budget_tokens = 24576;
        break;
    }
  }

  // 转换 max_output_tokens → max_tokens
  if (req.max_output_tokens) {
    output.max_tokens = req.max_output_tokens;
  }

  // 处理 instructions（转换为 user role 的 system message）
  let instructionsText = "";
  let extractedFromSystem = false;

  // 验证 instructions 必须是非空字符串（参考 ChatMock upstream.py:85-94）
  if (typeof req.instructions === "string" && req.instructions.trim()) {
    instructionsText = req.instructions.trim();
    output.messages.push({
      role: "user",
      content: instructionsText,
    });
  }

  // 如果没有 instructions，尝试从 input 中提取 system 消息
  if (!instructionsText && req.input && Array.isArray(req.input)) {
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
        instructionsText = parts.join("\n");
        if (instructionsText) {
          output.messages.push({
            role: "user",
            content: instructionsText,
          });
          extractedFromSystem = true;
          break;
        }
      }
    }
  }

  // 处理 input 数组
  if (req.input && Array.isArray(req.input)) {
    for (const item of req.input) {
      // 跳过已提取的 system 消息
      if (extractedFromSystem && item.role?.toLowerCase() === "system") {
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
            source?: {
              type: string;
              media_type?: string;
              data?: string;
              url?: string;
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
                    if (imageUrl.startsWith("data:")) {
                      // 处理 data URL
                      const trimmed = imageUrl.substring(5); // 移除 "data:"
                      const parts = trimmed.split(";base64,");
                      if (parts.length === 2) {
                        const mediaType = parts[0] || "application/octet-stream";
                        const data = parts[1];
                        if (data) {
                          contentParts.push({
                            type: "image",
                            source: {
                              type: "base64",
                              media_type: mediaType,
                              data,
                            },
                          });
                          hasImage = true;
                          if (!role) {
                            role = "user";
                          }
                        }
                      }
                    } else {
                      // 处理 URL
                      contentParts.push({
                        type: "image",
                        source: {
                          type: "url",
                          url: imageUrl,
                        },
                      });
                      hasImage = true;
                      if (!role) {
                        role = "user";
                      }
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
          // 转换为 assistant tool_use
          const callID = item.call_id || generateToolCallID();
          const name = item.name || "";
          let input: Record<string, unknown> = {};

          if (item.arguments) {
            if (typeof item.arguments === "string") {
              try {
                input = JSON.parse(item.arguments);
              } catch {
                // 解析失败时使用空对象
              }
            } else {
              input = item.arguments as Record<string, unknown>;
            }
          }

          output.messages.push({
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: callID,
                name,
                input,
              },
            ],
          });
          break;
        }

        case "function_call_output": {
          // 转换为 user tool_result
          const outputStr = item.output || "";

          output.messages.push({
            role: "user",
            content: outputStr, // Tool result as text content
          });
          break;
        }
      }
    }
  }

  // 转换 tools（parameters → input_schema）
  if (req.tools && Array.isArray(req.tools) && req.tools.length > 0) {
    output.tools = [];

    for (const tool of req.tools) {
      const claudeTool: {
        name: string;
        description?: string;
        input_schema: Record<string, unknown>;
      } = {
        name: tool.name || "",
        input_schema: {},
      };

      if (tool.description) {
        claudeTool.description = tool.description;
      }

      // parameters 或 parametersJsonSchema → input_schema
      if (tool.parameters) {
        claudeTool.input_schema = tool.parameters;
      } else if (tool.parametersJsonSchema) {
        claudeTool.input_schema = tool.parametersJsonSchema;
      }

      output.tools.push(claudeTool);
    }
  }

  // 转换 tool_choice
  if (req.tool_choice) {
    if (typeof req.tool_choice === "string") {
      switch (req.tool_choice) {
        case "auto":
          output.tool_choice = { type: "auto" };
          break;
        case "none":
          // 不设置 tool_choice
          break;
        case "required":
          output.tool_choice = { type: "any" };
          break;
      }
    } else if (typeof req.tool_choice === "object") {
      const tc = req.tool_choice as { type: string; function?: { name: string } };
      if (tc.type === "function" && tc.function?.name) {
        output.tool_choice = { type: "tool", name: tc.function.name };
      }
    }
  }

  logger.debug("[Codex→Claude] Request transformation completed", {
    messageCount: output.messages.length,
    hasThinking: !!output.thinking,
    hasTools: !!output.tools,
    toolsCount: output.tools?.length || 0,
    maxTokens: output.max_tokens,
  });

  return output as unknown as Record<string, unknown>;
}
