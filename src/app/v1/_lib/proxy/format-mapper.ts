import { detectEndpointFormat, type EndpointClientFormat } from "./endpoint-family-catalog";

/**
 * API 格式映射工具
 *
 * 统一管理客户端格式检测逻辑：
 * - 基于端点路径检测格式
 * - 基于请求体结构检测格式
 *
 * 背景：
 * - session.originalFormat 使用命名: "response" | "openai" | "claude" | "gemini" | "gemini-cli"
 * - 这些格式用于路由层识别客户端请求类型
 */

/**
 * Client Format（路由层检测到的请求格式）
 *
 * 这些值来自路由层的格式检测逻辑：
 * - "response": 检测到 Response API 格式（Codex）的请求（通过 `input` 字段）
 * - "openai": 检测到 OpenAI Chat Completions 格式的请求（通过 `messages` 字段）
 * - "claude": 检测到 Claude Messages API 格式的请求（通过 `system` 或 Claude 特有字段）
 * - "gemini": 检测到 Gemini API 直接格式的请求（通过 `contents` 字段）
 * - "gemini-cli": 检测到 Gemini CLI 格式的请求（通过 `request` envelope）
 */
export type ClientFormat = EndpointClientFormat;

/**
 * 根据请求端点检测客户端格式（优先级最高）
 *
 * 这是最准确的格式检测方式，因为端点路径明确表示了客户端的意图。
 * 应该优先使用此函数，失败时才回退到 detectClientFormat()。
 *
 * 支持的端点模式：
 * - Claude Messages API: `/v1/messages`, `/v1/messages/count_tokens`
 * - Codex Response API: `/v1/responses`
 * - OpenAI Compatible: `/v1/chat/completions`, `/v1/embeddings`
 * - Gemini Direct: `/v1beta/models/{model}:generateContent`, `/v1beta/models/{model}:embedContent`
 * - Gemini CLI: `/v1internal/models/{model}:generateContent`
 *
 * @param pathname - URL 路径（如 `/v1/messages`）
 * @returns 检测到的客户端格式，如果无法识别则返回 null
 *
 * @example
 * ```ts
 * detectFormatByEndpoint("/v1/messages") // => "claude"
 * detectFormatByEndpoint("/v1/responses") // => "response"
 * detectFormatByEndpoint("/v1beta/models/gemini-1.5-pro:generateContent") // => "gemini"
 * detectFormatByEndpoint("/unknown/path") // => null
 * ```
 */
export function detectFormatByEndpoint(pathname: string): ClientFormat | null {
  return detectEndpointFormat(pathname);
}

/**
 * 检测请求格式（基于请求体结构）
 *
 * 这个函数用于路由层自动检测请求格式，避免手动指定。
 *
 * 检测优先级：
 * 1. Gemini API: 存在 `contents` 数组且不包含 `request` envelope（直接 Gemini 格式）
 * 2. Gemini CLI: 存在 `request` envelope（CLI wrapper）
 * 3. Response API (Codex): 存在 `input` 数组
 * 4. OpenAI Compatible: 存在 `messages` 数组
 * 5. Claude Messages API: 默认（或存在 Claude 特有字段如 `system`）
 *
 * @param requestBody - 请求体（JSON 对象）
 * @returns 检测到的客户端格式
 */
export function detectClientFormat(requestBody: Record<string, unknown>): ClientFormat {
  // 1. 检测直接 Gemini API 格式（在 CLI 检测之前）
  // Gemini API 的特征：有 `contents` 数组，但没有 `request` envelope
  if (
    Array.isArray(requestBody.contents) &&
    !(typeof requestBody.request === "object" && requestBody.request !== null)
  ) {
    return "gemini";
  }

  // 2. 检测 Gemini CLI 格式（envelope 结构）
  if (typeof requestBody.request === "object" && requestBody.request !== null) {
    return "gemini-cli";
  }

  // 3. 检测 Gemini batch 格式
  if (Array.isArray(requestBody.requests)) {
    const isGeminiContentPayload = (value: unknown): boolean => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }

      const payload = value as Record<string, unknown>;
      return Array.isArray(payload.parts) || Array.isArray(payload.contents);
    };

    const hasGeminiBatchShape = requestBody.requests.some((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return false;
      }

      const record = entry as Record<string, unknown>;
      if (typeof record.model === "string" && isGeminiContentPayload(record.content)) {
        return true;
      }

      if (typeof record.request === "object" && record.request !== null) {
        const nestedRequest = record.request as Record<string, unknown>;
        return (
          typeof nestedRequest.model === "string" && isGeminiContentPayload(nestedRequest.content)
        );
      }

      return false;
    });

    if (hasGeminiBatchShape) {
      return "gemini";
    }
  }

  // 4. 检测 Response API (Codex) 格式
  // 仅通过 input 数组识别；字符串/单对象简写由 response-input-rectifier 在端点确认后规范化
  if (Array.isArray(requestBody.input)) {
    return "response";
  }

  // 5. 检测 OpenAI Compatible 格式
  if (Array.isArray(requestBody.messages)) {
    // 进一步区分 OpenAI 和 Claude
    // Claude 的 messages 可能包含 system，但 OpenAI 也可能有 system message
    // 主要区别：Claude 有顶级 system 数组，OpenAI 的 system 是 role: "system" 的消息
    if (Array.isArray(requestBody.system)) {
      // 顶级 system 数组 → Claude Messages API
      return "claude";
    }

    // 默认为 OpenAI Compatible
    return "openai";
  }

  // 6. 默认为 Claude Messages API
  return "claude";
}
