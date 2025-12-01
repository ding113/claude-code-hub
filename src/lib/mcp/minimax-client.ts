/**
 * MiniMax MCP 客户端
 * 实现 Web 搜索和图片理解功能
 */

import { logger } from "@/lib/logger";
import type {
  McpClientConfig,
  McpImageUnderstandRequest,
  McpImageUnderstandResponse,
  McpWebSearchRequest,
  McpWebSearchResponse,
} from "./types";
import { McpAuthError, McpRequestError } from "./types";

export class MinimaxMcpClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: McpClientConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
  }

  /**
   * Web 搜索
   * @param query 搜索查询
   * @returns 搜索结果
   */
  async webSearch(query: string): Promise<McpWebSearchResponse> {
    if (!query) {
      throw new McpRequestError("Query is required");
    }

    const payload: McpWebSearchRequest = {
      q: query,
    };

    logger.info("[MinimaxMcpClient] webSearch", { query });

    try {
      const response = await this.makeRequest<McpWebSearchResponse>(
        "/v1/coding_plan/search",
        payload
      );

      logger.info("[MinimaxMcpClient] webSearch success", {
        query,
        resultsCount: response.data?.results?.length ?? 0,
      });

      return response;
    } catch (error) {
      logger.error("[MinimaxMcpClient] webSearch failed", {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 图片理解
   * @param imageUrl 图片 URL
   * @param prompt 提示词
   * @returns 图片理解结果
   */
  async understandImage(imageUrl: string, prompt: string): Promise<McpImageUnderstandResponse> {
    if (!imageUrl) {
      throw new McpRequestError("Image URL is required");
    }
    if (!prompt) {
      throw new McpRequestError("Prompt is required");
    }

    const payload: McpImageUnderstandRequest = {
      image_url: imageUrl,
      prompt,
    };

    logger.info("[MinimaxMcpClient] understandImage", { imageUrl, prompt });

    try {
      const response = await this.makeRequest<McpImageUnderstandResponse>(
        "/v1/coding_plan/vlm",
        payload
      );

      logger.info("[MinimaxMcpClient] understandImage success", {
        imageUrl,
        prompt,
      });

      return response;
    } catch (error) {
      logger.error("[MinimaxMcpClient] understandImage failed", {
        imageUrl,
        prompt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 发起 HTTP 请求
   * @param endpoint API 端点
   * @param payload 请求体
   * @returns 响应数据
   */
  private async makeRequest<T>(endpoint: string, payload: unknown): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "MM-API-Source": "Claude-Code-Hub-MCP",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new McpRequestError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          response.headers.get("Trace-Id") ?? undefined
        );
      }

      const data = (await response.json()) as T & {
        base_resp?: { status_code: number; status_msg: string };
      };

      // 检查 API 特定的错误码
      if (data.base_resp && data.base_resp.status_code !== 0) {
        const { status_code, status_msg } = data.base_resp;
        const traceId = response.headers.get("Trace-Id") ?? undefined;

        switch (status_code) {
          case 1004:
            throw new McpAuthError(
              `API Error: ${status_msg}, please check your API key and API host. Trace-Id: ${traceId}`,
              traceId
            );
          case 2038:
            throw new McpRequestError(
              `API Error: ${status_msg}, should complete real-name verification on the open-platform(https://platform.minimaxi.com/user-center/basic-information). Trace-Id: ${traceId}`,
              status_code,
              traceId
            );
          default:
            throw new McpRequestError(
              `API Error: ${status_code}-${status_msg} Trace-Id: ${traceId}`,
              status_code,
              traceId
            );
        }
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new McpRequestError("Request timeout after 30 seconds");
      }
      if (error instanceof TypeError) {
        throw new McpRequestError(
          `Network error: ${error.message}. Failed to connect to ${this.baseUrl}. Check base URL, network connectivity, and firewall settings.`
        );
      }
      if (error instanceof McpAuthError || error instanceof McpRequestError) {
        throw error;
      }

      throw new McpRequestError(
        `Request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
