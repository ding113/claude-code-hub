/**
 * 转换器类型定义
 *
 * 基于 CLIProxyAPI 的转换器架构，实现多种 API 格式之间的互相转换。
 * 支持的格式：Claude Messages API, Response API (Codex), Gemini CLI, OpenAI Compatible
 */

import type { Context } from "hono";

/**
 * API 格式类型
 */
export type Format = "claude" | "codex" | "gemini-cli" | "openai-compatible";

/**
 * 请求转换函数类型
 *
 * 将请求从一种格式转换为另一种格式
 *
 * @param model - 模型名称
 * @param rawJSON - 原始请求体（JSON 对象）
 * @param stream - 是否为流式请求
 * @returns 转换后的请求体（JSON 对象）
 */
export type RequestTransform = (
  model: string,
  rawJSON: Record<string, unknown>,
  stream: boolean
) => Record<string, unknown>;

/**
 * 流式响应转换函数类型
 *
 * 将流式响应的每个 chunk 从一种格式转换为另一种格式
 *
 * @param ctx - Hono 上下文
 * @param model - 模型名称
 * @param originalRequest - 原始请求体（转换前）
 * @param transformedRequest - 转换后的请求体
 * @param chunk - 当前响应 chunk（可能是 SSE 格式）
 * @param state - 状态对象（用于在多个 chunk 之间保持状态）
 * @returns 转换后的 chunk 数组（可能一个 chunk 转换为多个）
 */
export type ResponseStreamTransform = (
  ctx: Context,
  model: string,
  originalRequest: Record<string, unknown>,
  transformedRequest: Record<string, unknown>,
  chunk: string,
  state?: TransformState
) => string[];

/**
 * 非流式响应转换函数类型
 *
 * 将完整响应从一种格式转换为另一种格式
 *
 * @param ctx - Hono 上下文
 * @param model - 模型名称
 * @param originalRequest - 原始请求体（转换前）
 * @param transformedRequest - 转换后的请求体
 * @param response - 原始响应体
 * @returns 转换后的响应体
 */
export type ResponseNonStreamTransform = (
  ctx: Context,
  model: string,
  originalRequest: Record<string, unknown>,
  transformedRequest: Record<string, unknown>,
  response: Record<string, unknown>
) => Record<string, unknown>;

/**
 * 响应转换器（包含流式和非流式两种）
 */
export interface ResponseTransform {
  /** 流式响应转换函数 */
  stream?: ResponseStreamTransform;
  /** 非流式响应转换函数 */
  nonStream?: ResponseNonStreamTransform;
}

/**
 * 转换状态（用于流式响应转换中保持状态）
 */
export interface TransformState {
  /** 是否有工具调用 */
  hasToolCall?: boolean;
  /** 当前内容块索引 */
  currentIndex?: number;
  /** 当前内容块类型 */
  currentBlockType?: "text" | "thinking" | "tool_use";
  /** 其他自定义状态 */
  [key: string]: unknown;
}

/**
 * 转换器配置
 */
export interface TransformerConfig {
  /** 源格式 */
  from: Format;
  /** 目标格式 */
  to: Format;
  /** 请求转换器 */
  request?: RequestTransform;
  /** 响应转换器 */
  response?: ResponseTransform;
}

/**
 * 转换器元数据
 */
export interface TransformerMetadata {
  /** 转换器名称 */
  name: string;
  /** 转换器描述 */
  description: string;
  /** 源格式 */
  from: Format;
  /** 目标格式 */
  to: Format;
  /** 支持的模型列表（可选，null 表示支持所有模型） */
  supportedModels?: string[] | null;
}
