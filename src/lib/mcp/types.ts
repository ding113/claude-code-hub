/**
 * MCP (Model Context Protocol) 类型定义
 * 用于 MiniMax 等第三方 AI 服务的工具调用透传
 */

// MCP 客户端配置
export interface McpClientConfig {
  baseUrl: string;
  apiKey: string;
}

// Web 搜索请求
export interface McpWebSearchRequest {
  q: string; // 搜索查询
}

// Web 搜索响应
export interface McpWebSearchResponse {
  base_resp: {
    status_code: number;
    status_msg: string;
  };
  data?: {
    results: Array<{
      title: string;
      url: string;
      snippet: string;
    }>;
  };
}

// 图片理解请求
export interface McpImageUnderstandRequest {
  image_url: string; // 图片 URL
  prompt: string; // 提示词
}

// 图片理解响应
export interface McpImageUnderstandResponse {
  base_resp: {
    status_code: number;
    status_msg: string;
  };
  data?: {
    description: string;
    analysis: string;
  };
}

// MCP 错误类型
export class McpError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public traceId?: string
  ) {
    super(message);
    this.name = "McpError";
  }
}

// MCP 认证错误
export class McpAuthError extends McpError {
  constructor(message: string, traceId?: string) {
    super(message, 1004, traceId);
    this.name = "McpAuthError";
  }
}

// MCP 请求错误
export class McpRequestError extends McpError {
  constructor(message: string, statusCode?: number, traceId?: string) {
    super(message, statusCode, traceId);
    this.name = "McpRequestError";
  }
}
