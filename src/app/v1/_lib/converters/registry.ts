/**
 * 转换器注册表
 *
 * 管理所有格式之间的转换器，提供注册、查询和执行转换的功能。
 * 基于 CLIProxyAPI 的 Registry 模式实现。
 */

import type { Context } from "hono";
import { logger } from "@/lib/logger";
import type { Format, RequestTransform, ResponseTransform, TransformState } from "./types";

/**
 * 转换器注册表类
 *
 * 使用 Map 存储所有格式之间的转换函数，支持动态注册和查询。
 */
export class TransformerRegistry {
  /** 请求转换器映射：from → to → transformer */
  private requests: Map<Format, Map<Format, RequestTransform>>;

  /** 响应转换器映射：from → to → transformer */
  private responses: Map<Format, Map<Format, ResponseTransform>>;

  constructor() {
    this.requests = new Map();
    this.responses = new Map();
  }

  /**
   * 注册转换器
   *
   * @param from - 源格式
   * @param to - 目标格式
   * @param request - 请求转换函数（可选）
   * @param response - 响应转换器（可选）
   */
  register(
    from: Format,
    to: Format,
    request?: RequestTransform,
    response?: ResponseTransform
  ): void {
    // 注册请求转换器
    if (request) {
      if (!this.requests.has(from)) {
        this.requests.set(from, new Map());
      }
      this.requests.get(from)?.set(to, request);
      logger.debug(`[Registry] Registered request transformer: ${from} → ${to}`);
    }

    // 注册响应转换器
    if (response) {
      if (!this.responses.has(from)) {
        this.responses.set(from, new Map());
      }
      this.responses.get(from)?.set(to, response);
      logger.debug(`[Registry] Registered response transformer: ${from} → ${to}`);
    }
  }

  /**
   * 转换请求
   *
   * @param from - 源格式
   * @param to - 目标格式
   * @param model - 模型名称
   * @param rawJSON - 原始请求体
   * @param stream - 是否为流式请求
   * @returns 转换后的请求体（如果没有转换器，返回原始请求）
   */
  transformRequest(
    from: Format,
    to: Format,
    model: string,
    rawJSON: Record<string, unknown>,
    stream: boolean
  ): Record<string, unknown> {
    const transformers = this.requests.get(from);
    if (!transformers) {
      logger.debug(`[Registry] No request transformers registered for format: ${from}`);
      return rawJSON;
    }

    const transformer = transformers.get(to);
    if (!transformer) {
      logger.debug(
        `[Registry] No request transformer found: ${from} → ${to}, using original request`
      );
      return rawJSON;
    }

    logger.info(
      `[Registry] Transforming request: ${from} → ${to}, model: ${model}, stream: ${stream}`
    );
    try {
      return transformer(model, rawJSON, stream);
    } catch (error) {
      logger.error(`[Registry] Request transformation failed: ${from} → ${to}`, {
        error,
        model,
        stream,
      });
      // 转换失败时返回原始请求
      return rawJSON;
    }
  }

  /**
   * 检查是否存在响应转换器
   *
   * @param from - 源格式
   * @param to - 目标格式
   * @returns 是否存在响应转换器
   */
  hasResponseTransformer(from: Format, to: Format): boolean {
    const transformers = this.responses.get(from);
    return !!transformers && transformers.has(to);
  }

  /**
   * 转换流式响应
   *
   * @param ctx - Hono 上下文
   * @param from - 源格式
   * @param to - 目标格式
   * @param model - 模型名称
   * @param originalRequest - 原始请求体
   * @param transformedRequest - 转换后的请求体
   * @param chunk - 当前 chunk
   * @param state - 状态对象
   * @returns 转换后的 chunk 数组（如果没有转换器，返回原始 chunk）
   */
  transformStreamResponse(
    ctx: Context,
    from: Format,
    to: Format,
    model: string,
    originalRequest: Record<string, unknown>,
    transformedRequest: Record<string, unknown>,
    chunk: string,
    state?: TransformState
  ): string[] {
    const transformers = this.responses.get(from);
    if (!transformers) {
      return [chunk];
    }

    const transformer = transformers.get(to);
    if (!transformer || !transformer.stream) {
      return [chunk];
    }

    try {
      return transformer.stream(ctx, model, originalRequest, transformedRequest, chunk, state);
    } catch (error) {
      logger.error(`[Registry] Stream response transformation failed: ${from} → ${to}`, {
        error,
        model,
      });
      // 转换失败时返回原始 chunk
      return [chunk];
    }
  }

  /**
   * 转换非流式响应
   *
   * @param ctx - Hono 上下文
   * @param from - 源格式
   * @param to - 目标格式
   * @param model - 模型名称
   * @param originalRequest - 原始请求体
   * @param transformedRequest - 转换后的请求体
   * @param response - 原始响应体
   * @returns 转换后的响应体（如果没有转换器，返回原始响应）
   */
  transformNonStreamResponse(
    ctx: Context,
    from: Format,
    to: Format,
    model: string,
    originalRequest: Record<string, unknown>,
    transformedRequest: Record<string, unknown>,
    response: Record<string, unknown>
  ): Record<string, unknown> {
    const transformers = this.responses.get(from);
    if (!transformers) {
      return response;
    }

    const transformer = transformers.get(to);
    if (!transformer || !transformer.nonStream) {
      logger.debug(
        `[Registry] No non-stream transformer found: ${from} → ${to}, using original response`
      );
      return response;
    }

    logger.info(`[Registry] Transforming non-stream response: ${from} → ${to}, model: ${model}`);
    try {
      return transformer.nonStream(ctx, model, originalRequest, transformedRequest, response);
    } catch (error) {
      logger.error(`[Registry] Non-stream response transformation failed: ${from} → ${to}`, {
        error,
        model,
      });
      // 转换失败时返回原始响应
      return response;
    }
  }

  /**
   * 获取所有已注册的转换器信息（调试用）
   */
  getRegisteredTransformers(): {
    requests: Array<{ from: Format; to: Format }>;
    responses: Array<{ from: Format; to: Format }>;
  } {
    const requests: Array<{ from: Format; to: Format }> = [];
    const responses: Array<{ from: Format; to: Format }> = [];

    this.requests.forEach((targets, from) => {
      targets.forEach((_, to) => {
        requests.push({ from, to });
      });
    });

    this.responses.forEach((targets, from) => {
      targets.forEach((_, to) => {
        responses.push({ from, to });
      });
    });

    return { requests, responses };
  }
}

/**
 * 全局转换器注册表实例
 */
export const defaultRegistry = new TransformerRegistry();

/**
 * 注册转换器的便捷函数
 */
export function registerTransformer(
  from: Format,
  to: Format,
  request?: RequestTransform,
  response?: ResponseTransform
): void {
  defaultRegistry.register(from, to, request, response);
}
