/**
 * GLM MCP 客户端
 * 实现图片分析和视频分析功能
 */

import { logger } from "@/lib/logger";
import type {
  McpClientConfig,
  McpGlmImageAnalyzeRequest,
  McpGlmImageAnalyzeResponse,
  McpGlmVideoAnalyzeRequest,
  McpGlmVideoAnalyzeResponse,
} from "./types";
import { McpAuthError, McpRequestError } from "./types";

/**
 * GLM MCP 客户端
 * 提供图片和视频分析功能
 */
export class GlmMcpClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: McpClientConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
  }

  /**
   * 分析图片
   * @param imageSource 图片源（本地路径或远程 URL）
   * @param prompt 提示词
   * @returns 图片分析结果
   */
  async analyzeImage(imageSource: string, prompt: string): Promise<McpGlmImageAnalyzeResponse> {
    if (!imageSource) {
      throw new McpRequestError("Image source is required");
    }
    if (!prompt) {
      throw new McpRequestError("Prompt is required");
    }

    const payload: McpGlmImageAnalyzeRequest = {
      image_source: imageSource,
      prompt,
    };

    logger.info("[GlmMcpClient] analyzeImage", { imageSource, prompt });

    try {
      // GLM 使用多模态接口处理图片分析
      // 这里模拟 GLM MCP 工具的调用方式
      const response = await this.makeRequest<McpGlmImageAnalyzeResponse>(
        "/api/chat/completions",
        payload
      );

      logger.info("[GlmMcpClient] analyzeImage success", {
        imageSource,
        prompt,
      });

      return response;
    } catch (error) {
      logger.error("[GlmMcpClient] analyzeImage failed", {
        imageSource,
        prompt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 分析视频
   * @param videoSource 视频源（本地路径或远程 URL）
   * @param prompt 提示词
   * @returns 视频分析结果
   */
  async analyzeVideo(videoSource: string, prompt: string): Promise<McpGlmVideoAnalyzeResponse> {
    if (!videoSource) {
      throw new McpRequestError("Video source is required");
    }
    if (!prompt) {
      throw new McpRequestError("Prompt is required");
    }

    const payload: McpGlmVideoAnalyzeRequest = {
      video_source: videoSource,
      prompt,
    };

    logger.info("[GlmMcpClient] analyzeVideo", { videoSource, prompt });

    try {
      // GLM 使用多模态接口处理视频分析
      const response = await this.makeRequest<McpGlmVideoAnalyzeResponse>(
        "/api/chat/completions",
        payload
      );

      logger.info("[GlmMcpClient] analyzeVideo success", {
        videoSource,
        prompt,
      });

      return response;
    } catch (error) {
      logger.error("[GlmMcpClient] analyzeVideo failed", {
        videoSource,
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

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "GLM-API-Source": "Claude-Code-Hub-MCP",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new McpRequestError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          response.headers.get("Trace-Id") ?? undefined
        );
      }

      const data = (await response.json()) as T;

      // GLM 可能有不同的错误格式，这里做基本检查
      // 实际错误处理需要根据 GLM API 的具体响应格式调整

      return data;
    } catch (error) {
      if (error instanceof McpAuthError || error instanceof McpRequestError) {
        throw error;
      }

      throw new McpRequestError(
        `Request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
