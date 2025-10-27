/**
 * Gemini CLI → Claude Messages API 请求转换器
 *
 * 基于 CLIProxyAPI 的实现：
 * - /internal/translator/gemini-cli/claude/gemini-cli_claude_request.go
 *
 * Gemini CLI 请求格式结构：
 * {
 *   "model": "gemini-2.0-flash",
 *   "request": {
 *     "systemInstruction": {
 *       "role": "user",
 *       "parts": [{"text": "..."}]
 *     },
 *     "contents": [
 *       {
 *         "role": "user|model",
 *         "parts": [
 *           {"text": "..."},
 *           {"functionCall": {"name": "...", "args": {...}}},
 *           {"functionResponse": {"name": "...", "response": {...}}}
 *         ]
 *       }
 *     ],
 *     "tools": [
 *       {
 *         "functionDeclarations": [
 *           {
 *             "name": "...",
 *             "description": "...",
 *             "parametersJsonSchema": {...}
 *           }
 *         ]
 *       }
 *     ],
 *     "generationConfig": {
 *       "thinkingConfig": {"include_thoughts": true, "thinkingBudget": 8192}
 *     }
 *   }
 * }
 *
 * 核心转换映射：
 * - request.systemInstruction → system (text 数组)
 * - request.contents[] → messages[]
 * - role: "model" → "assistant"
 * - parts[].text → content text
 * - parts[].functionCall → tool_use
 * - parts[].functionResponse → tool_result
 * - tools[0].functionDeclarations[] → tools[]
 * - parametersJsonSchema → input_schema
 * - thinkingConfig.thinkingBudget → thinking.budget_tokens
 */

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
      thinkingConfig?: {
        include_thoughts?: boolean;
        thinkingBudget?: number; // -1=auto, 0=disabled, >0=token budget
      };
    };
  };
  [key: string]: unknown;
}

/**
 * Claude Messages API 格式的请求体接口
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
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
          tool_use_id?: string;
          content?: string | Array<unknown>;
        }>;
  }>;
  system?: Array<{ type: string; text: string }>;
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
 * 生成用户 ID（基于随机值）
 */
function generateUserID(): string {
  const randomPart = Math.random().toString(36).substring(2, 15);
  return `user_gemini_${randomPart}`;
}

/**
 * 转换 Gemini CLI 请求为 Claude Messages API 格式
 *
 * @param model - 模型名称
 * @param request - Gemini CLI 格式的请求体
 * @param stream - 是否为流式请求
 * @returns Claude Messages API 格式的请求体
 */
export function transformGeminiCLIRequestToClaude(
  model: string,
  request: Record<string, unknown>,
  stream: boolean
): Record<string, unknown> {
  const req = request as GeminiCLIRequest;

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

  logger.debug("[GeminiCLI→Claude] Starting request transformation", {
    model,
    stream,
    hasSystemInstruction: !!req.request?.systemInstruction,
    contentsCount: req.request?.contents?.length || 0,
    hasTools: !!req.request?.tools,
    toolsCount: req.request?.tools?.[0]?.functionDeclarations?.length || 0,
  });

  // 处理 systemInstruction → system
  if (req.request?.systemInstruction?.parts && Array.isArray(req.request.systemInstruction.parts)) {
    const systemParts: Array<{ type: string; text: string }> = [];

    for (const part of req.request.systemInstruction.parts) {
      if (part.text) {
        systemParts.push({
          type: "text",
          text: part.text,
        });
      }
    }

    if (systemParts.length > 0) {
      output.system = systemParts;
    }
  }

  // 处理 contents[] → messages[]
  if (req.request?.contents && Array.isArray(req.request.contents)) {
    for (const content of req.request.contents) {
      let role = content.role || "user";

      // 角色映射：model → assistant
      if (role === "model") {
        role = "assistant";
      }

      const parts = content.parts;
      if (!parts || !Array.isArray(parts)) {
        continue;
      }

      const contentParts: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
        tool_use_id?: string;
        content?: string;
      }> = [];

      for (const part of parts) {
        // 处理 text 内容
        if (part.text) {
          contentParts.push({
            type: "text",
            text: part.text,
          });
        }

        // 处理 functionCall → tool_use
        if (part.functionCall) {
          const funcName = part.functionCall.name || "";
          const args = part.functionCall.args || {};

          // 生成工具调用 ID
          const toolCallID = `toolu_${funcName}_${Math.random().toString(36).substring(2, 10)}`;

          contentParts.push({
            type: "tool_use",
            id: toolCallID,
            name: funcName,
            input: args,
          });
        }

        // 处理 functionResponse → tool_result
        if (part.functionResponse) {
          const funcName = part.functionResponse.name || "";
          const response = part.functionResponse.response || {};

          // 提取响应内容
          let resultContent = "";
          if (typeof response.result === "string") {
            resultContent = response.result;
          } else {
            resultContent = JSON.stringify(response);
          }

          // 注意：Gemini CLI 的 functionResponse 没有 tool_use_id
          // 我们需要从函数名推断（可能需要维护映射）
          const toolUseID = `toolu_${funcName}_result`;

          contentParts.push({
            type: "tool_result",
            tool_use_id: toolUseID,
            content: resultContent,
          });
        }
      }

      // 构建消息
      if (contentParts.length === 1 && contentParts[0].type === "text") {
        // 简化格式：单个文本内容
        output.messages.push({
          role,
          content: contentParts[0].text || "",
        });
      } else if (contentParts.length > 0) {
        // 数组格式：多内容或包含工具调用
        output.messages.push({
          role,
          content: contentParts,
        });
      }
    }
  }

  // 处理 tools → tools
  if (req.request?.tools && Array.isArray(req.request.tools) && req.request.tools.length > 0) {
    const toolDeclarations = req.request.tools[0]?.functionDeclarations;

    if (toolDeclarations && Array.isArray(toolDeclarations) && toolDeclarations.length > 0) {
      output.tools = [];

      for (const funcDecl of toolDeclarations) {
        const claudeTool: {
          name: string;
          description?: string;
          input_schema: Record<string, unknown>;
        } = {
          name: funcDecl.name || "",
          input_schema: funcDecl.parametersJsonSchema || {},
        };

        if (funcDecl.description) {
          claudeTool.description = funcDecl.description;
        }

        output.tools.push(claudeTool);
      }
    }
  }

  // 处理 thinkingConfig → thinking
  const thinkingConfig = req.request?.generationConfig?.thinkingConfig;
  if (thinkingConfig) {
    const includeThoughts = thinkingConfig.include_thoughts ?? true;
    const budget = thinkingConfig.thinkingBudget;

    if (includeThoughts && budget !== 0) {
      output.thinking = { type: "enabled" };

      if (typeof budget === "number" && budget > 0) {
        output.thinking.budget_tokens = budget;
      }
    } else if (budget === 0 || !includeThoughts) {
      output.thinking = { type: "disabled" };
    }
  }

  // 处理其他生成配置
  if (req.request?.generationConfig) {
    const genConfig = req.request.generationConfig;

    if (typeof genConfig.temperature === "number") {
      output.temperature = genConfig.temperature;
    }
    if (typeof genConfig.topP === "number") {
      output.top_p = genConfig.topP;
    }
    if (typeof genConfig.topK === "number") {
      output.top_k = genConfig.topK;
    }
  }

  logger.debug("[GeminiCLI→Claude] Request transformation completed", {
    messageCount: output.messages.length,
    hasSystem: !!output.system,
    hasThinking: !!output.thinking,
    hasTools: !!output.tools,
    toolsCount: output.tools?.length || 0,
  });

  return output as unknown as Record<string, unknown>;
}
