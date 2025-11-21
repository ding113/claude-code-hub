/**
 * MCP 透传处理器
 *
 * 检测并处理 MCP 工具调用，将其透传到配置的第三方 AI 服务商
 * 例如：将 web_search、understand_image 等工具调用透传到 minimax
 */

import type { Provider } from "@/types/provider";
import { logger } from "@/lib/logger";
import { MinimaxMcpClient } from "@/lib/mcp/minimax-client";
import type { McpClientConfig } from "@/lib/mcp/types";
import { McpError } from "@/lib/mcp/types";

/**
 * MCP 工具调用信息
 */
interface McpToolCall {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * MCP 工具响应
 */
interface McpToolResponse {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

/**
 * MCP 透传处理器
 */
export class McpPassthroughHandler {
  /**
   * 检查是否应该处理该工具调用
   *
   * @param provider - 供应商配置
   * @param toolName - 工具名称
   * @returns 是否应该处理
   */
  static shouldHandle(provider: Provider, toolName: string): boolean {
    // 检查供应商是否配置了 MCP 透传
    if (!provider.mcpPassthroughType || provider.mcpPassthroughType === "none") {
      return false;
    }

    // 检查工具名称是否支持
    const supportedTools = this.getSupportedTools(provider.mcpPassthroughType);
    return supportedTools.includes(toolName);
  }

  /**
   * 获取支持的工具列表
   *
   * @param mcpType - MCP 透传类型
   * @returns 支持的工具名称列表
   */
  private static getSupportedTools(mcpType: string): string[] {
    switch (mcpType) {
      case "minimax":
        return ["web_search", "understand_image"];
      case "glm":
        // 预留：智谱 GLM 支持的工具
        return [];
      case "custom":
        // 预留：自定义 MCP 服务支持的工具
        return [];
      default:
        return [];
    }
  }

  /**
   * 处理工具调用
   *
   * @param provider - 供应商配置
   * @param toolCall - 工具调用信息
   * @returns 工具响应
   */
  static async handleToolCall(
    provider: Provider,
    toolCall: McpToolCall
  ): Promise<McpToolResponse> {
    logger.info("[McpPassthroughHandler] Handling tool call", {
      providerId: provider.id,
      providerName: provider.name,
      mcpType: provider.mcpPassthroughType,
      toolName: toolCall.name,
      toolId: toolCall.id,
    });

    try {
      // 根据 MCP 类型选择客户端
      switch (provider.mcpPassthroughType) {
        case "minimax":
          return await this.handleMinimaxToolCall(provider, toolCall);
        case "glm":
          throw new McpError("GLM MCP passthrough is not implemented yet");
        case "custom":
          throw new McpError("Custom MCP passthrough is not implemented yet");
        default:
          throw new McpError(`Unsupported MCP type: ${provider.mcpPassthroughType}`);
      }
    } catch (error) {
      logger.error("[McpPassthroughHandler] Tool call failed", {
        providerId: provider.id,
        toolName: toolCall.name,
        toolId: toolCall.id,
        error: error instanceof Error ? error.message : String(error),
      });

      // 返回错误响应
      return {
        type: "tool_result",
        tool_use_id: toolCall.id,
        content: `MCP tool call failed: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true,
      };
    }
  }

  /**
   * 处理 Minimax 工具调用
   *
   * @param provider - 供应商配置
   * @param toolCall - 工具调用信息
   * @returns 工具响应
   */
  private static async handleMinimaxToolCall(
    provider: Provider,
    toolCall: McpToolCall
  ): Promise<McpToolResponse> {
    // 创建 Minimax 客户端
    const config: McpClientConfig = {
      baseUrl: provider.url,
      apiKey: provider.key,
    };
    const client = new MinimaxMcpClient(config);

    // 根据工具名称调用对应方法
    switch (toolCall.name) {
      case "web_search": {
        const query = toolCall.input.query as string;
        if (!query) {
          throw new McpError("Missing required parameter: query");
        }

        const response = await client.webSearch(query);

        // 格式化响应
        return {
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: JSON.stringify(response, null, 2),
        };
      }

      case "understand_image": {
        const imageUrl = toolCall.input.image_url as string;
        const prompt = toolCall.input.prompt as string;

        if (!imageUrl) {
          throw new McpError("Missing required parameter: image_url");
        }
        if (!prompt) {
          throw new McpError("Missing required parameter: prompt");
        }

        const response = await client.understandImage(imageUrl, prompt);

        // 格式化响应
        return {
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: JSON.stringify(response, null, 2),
        };
      }

      default:
        throw new McpError(`Unsupported tool: ${toolCall.name}`);
    }
  }

  /**
   * 从请求中提取工具调用
   *
   * @param requestBody - 请求体
   * @returns 工具调用列表（如果有）
   */
  static extractToolCalls(requestBody: unknown): McpToolCall[] | null {
    if (!requestBody || typeof requestBody !== "object") {
      return null;
    }

    const body = requestBody as Record<string, unknown>;

    // 检查是否包含 messages 数组
    if (!Array.isArray(body.messages)) {
      return null;
    }

    // 查找包含 tool_use 的消息
    const toolCalls: McpToolCall[] = [];

    for (const message of body.messages) {
      if (typeof message !== "object" || !message) {
        continue;
      }

      const msg = message as Record<string, unknown>;

      // 检查 content 数组
      if (Array.isArray(msg.content)) {
        for (const content of msg.content) {
          if (
            typeof content === "object" &&
            content &&
            "type" in content &&
            content.type === "tool_use"
          ) {
            toolCalls.push(content as McpToolCall);
          }
        }
      }
    }

    return toolCalls.length > 0 ? toolCalls : null;
  }
}
