/**
 * 错误覆写响应验证工具
 *
 * 提供统一的 JSON 结构验证，防止纯文本或畸形数据透传给客户端。
 * 在规则加载阶段和运行时响应阶段复用同一验证逻辑。
 *
 * 当前支持三种格式：
 * 1. Claude 格式 - 有顶层 type: "error" 和 error.type
 * 2. Gemini 格式 - 有 error.code (number) 和 error.status (string)
 * 3. OpenAI 格式 - 有 error.type (string) 和 error.message (string)，无顶层 type
 */

import type { ErrorOverrideResponse } from "@/repository/error-rules";

/** 覆写响应体最大字节数限制 (10KB) */
const MAX_OVERRIDE_RESPONSE_BYTES = 10 * 1024;

/** 错误响应格式类型 */
export type ErrorResponseFormat = "claude" | "gemini" | "openai";

/**
 * 检测错误响应的格式类型
 *
 * @param response - 待检测的响应对象
 * @returns 格式类型 ("claude" | "gemini") 或 null（无法识别）
 */
export function detectErrorResponseFormat(response: unknown): ErrorResponseFormat | null {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return null;
  }

  const obj = response as Record<string, unknown>;

  // Claude 格式：有顶层 type: "error"
  if (obj.type === "error" && obj.error && typeof obj.error === "object") {
    return "claude";
  }

  // Gemini 格式：有 error.code (number) 和 error.status (string)
  if (obj.error && typeof obj.error === "object" && !Array.isArray(obj.error)) {
    const errorObj = obj.error as Record<string, unknown>;
    if (typeof errorObj.code === "number" && typeof errorObj.status === "string") {
      return "gemini";
    }
    // OpenAI 格式：有 error.type (string) 和 error.message (string)，无顶层 type
    // 注意：必须在 Claude 格式检测之后，因为 Claude 也有 error.type 和 error.message
    if (typeof errorObj.type === "string" && typeof errorObj.message === "string") {
      return "openai";
    }
  }

  return null;
}

/**
 * 验证 Claude 格式的错误覆写响应
 *
 * 必须满足的结构：
 * {
 *   "type": "error",
 *   "error": {
 *     "type": string,
 *     "message": string
 *   }
 * }
 */
function validateClaudeFormat(obj: Record<string, unknown>): string | null {
  // 顶层 type 必须为 "error"
  if (typeof obj.type !== "string" || obj.type.trim().length === 0) {
    return "Claude 格式覆写响应缺少 type 字段";
  }
  if (obj.type !== "error") {
    return 'Claude 格式覆写响应 type 字段必须为 "error"';
  }

  // error 对象存在且不是数组
  if (!obj.error || typeof obj.error !== "object" || Array.isArray(obj.error)) {
    return "Claude 格式覆写响应缺少 error 对象";
  }

  const errorObj = obj.error as Record<string, unknown>;

  if (typeof errorObj.type !== "string" || errorObj.type.trim().length === 0) {
    return "Claude 格式覆写响应 error.type 字段缺失或为空";
  }

  // message 允许为空字符串，运行时将回退到原始错误消息
  if (typeof errorObj.message !== "string") {
    return "Claude 格式覆写响应 error.message 字段必须是字符串";
  }

  if (obj.request_id !== undefined && typeof obj.request_id !== "string") {
    return "Claude 格式覆写响应 request_id 字段必须是字符串";
  }

  return null;
}

/**
 * 验证 Gemini 格式的错误覆写响应
 *
 * 必须满足的结构：
 * {
 *   "error": {
 *     "code": number,
 *     "message": string,
 *     "status": string
 *   }
 * }
 */
function validateGeminiFormat(obj: Record<string, unknown>): string | null {
  // error 对象存在且不是数组
  if (!obj.error || typeof obj.error !== "object" || Array.isArray(obj.error)) {
    return "Gemini 格式覆写响应缺少 error 对象";
  }

  const errorObj = obj.error as Record<string, unknown>;

  // code 必须是数字
  if (typeof errorObj.code !== "number") {
    return "Gemini 格式覆写响应 error.code 字段必须是数字";
  }

  // message 必须是字符串（允许为空，运行时回退到原始错误消息）
  if (typeof errorObj.message !== "string") {
    return "Gemini 格式覆写响应 error.message 字段必须是字符串";
  }

  // status 必须是非空字符串
  if (typeof errorObj.status !== "string" || errorObj.status.trim().length === 0) {
    return "Gemini 格式覆写响应 error.status 字段缺失或为空";
  }

  // details 是可选的，但如果存在必须是数组
  if (errorObj.details !== undefined && !Array.isArray(errorObj.details)) {
    return "Gemini 格式覆写响应 error.details 字段必须是数组";
  }

  return null;
}

/**
 * 验证 OpenAI 格式的错误覆写响应
 *
 * 必须满足的结构：
 * {
 *   "error": {
 *     "message": string,
 *     "type": string,
 *     "param"?: string | null,
 *     "code"?: string | null
 *   }
 * }
 *
 * 参考: https://platform.openai.com/docs/guides/error-codes
 */
function validateOpenAIFormat(obj: Record<string, unknown>): string | null {
  // error 对象存在且不是数组
  if (!obj.error || typeof obj.error !== "object" || Array.isArray(obj.error)) {
    return "OpenAI 格式覆写响应缺少 error 对象";
  }

  const errorObj = obj.error as Record<string, unknown>;

  // type 必须是非空字符串
  if (typeof errorObj.type !== "string" || errorObj.type.trim().length === 0) {
    return "OpenAI 格式覆写响应 error.type 字段缺失或为空";
  }

  // message 必须是字符串（允许为空，运行时回退到原始错误消息）
  if (typeof errorObj.message !== "string") {
    return "OpenAI 格式覆写响应 error.message 字段必须是字符串";
  }

  // param 是可选的，可以是 string 或 null
  if (
    errorObj.param !== undefined &&
    errorObj.param !== null &&
    typeof errorObj.param !== "string"
  ) {
    return "OpenAI 格式覆写响应 error.param 字段必须是字符串或 null";
  }

  // code 是可选的，可以是 string 或 null
  if (errorObj.code !== undefined && errorObj.code !== null && typeof errorObj.code !== "string") {
    return "OpenAI 格式覆写响应 error.code 字段必须是字符串或 null";
  }

  return null;
}

/**
 * 验证错误覆写响应的 JSON 结构是否合法（返回具体错误消息）
 *
 * 支持三种格式：
 * 1. Claude 格式：{ "type": "error", "error": { "type": string, "message": string } }
 * 2. Gemini 格式：{ "error": { "code": number, "message": string, "status": string } }
 * 3. OpenAI 格式：{ "error": { "type": string, "message": string, "param"?: string | null, "code"?: string | null } }
 *
 * @param response - 待验证的响应对象
 * @returns 错误消息（如果验证失败）或 null（验证通过）
 */
export function validateErrorOverrideResponse(response: unknown): string | null {
  // 检查是否为纯对象（排除 null 和数组）
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return "覆写响应必须是对象";
  }

  const obj = response as Record<string, unknown>;

  // 检测格式类型
  const format = detectErrorResponseFormat(response);

  if (format === "claude") {
    const claudeError = validateClaudeFormat(obj);
    if (claudeError) {
      return claudeError;
    }
  } else if (format === "gemini") {
    const geminiError = validateGeminiFormat(obj);
    if (geminiError) {
      return geminiError;
    }
  } else if (format === "openai") {
    const openaiError = validateOpenAIFormat(obj);
    if (openaiError) {
      return openaiError;
    }
  } else {
    // 无法识别的格式，尝试分别验证并给出更详细的提示
    // 检查是否有 error 对象
    if (!obj.error || typeof obj.error !== "object" || Array.isArray(obj.error)) {
      return "覆写响应缺少 error 对象";
    }

    const errorObj = obj.error as Record<string, unknown>;

    // 检查是否是不完整的 Claude 格式
    if (obj.type === "error") {
      return validateClaudeFormat(obj);
    }

    // 检查是否是不完整的 Gemini 格式
    if (typeof errorObj.code === "number" || typeof errorObj.status === "string") {
      return validateGeminiFormat(obj);
    }

    // 检查是否是不完整的 OpenAI 格式
    if (typeof errorObj.type === "string" || typeof errorObj.message === "string") {
      return validateOpenAIFormat(obj);
    }

    // 都不匹配，给出通用提示
    return '覆写响应格式无法识别。支持 Claude 格式（需要 type: "error" 和 error.type）、Gemini 格式（需要 error.code 和 error.status）或 OpenAI 格式（需要 error.type 和 error.message）';
  }

  // 检查响应体大小限制
  try {
    const jsonString = JSON.stringify(response);
    const byteLength = new TextEncoder().encode(jsonString).length;
    if (byteLength > MAX_OVERRIDE_RESPONSE_BYTES) {
      return `覆写响应体大小 (${Math.round(byteLength / 1024)}KB) 超过限制 (10KB)`;
    }
  } catch {
    return "覆写响应无法序列化为 JSON";
  }

  return null;
}

/**
 * 验证错误覆写响应的 JSON 结构是否合法（类型守卫）
 *
 * @param response - 待验证的响应对象
 * @returns 是否为合法的 ErrorOverrideResponse
 */
export function isValidErrorOverrideResponse(response: unknown): response is ErrorOverrideResponse {
  return validateErrorOverrideResponse(response) === null;
}

/**
 * 检查响应是否为 Claude 格式
 */
export function isClaudeErrorFormat(response: unknown): boolean {
  return detectErrorResponseFormat(response) === "claude";
}

/**
 * 检查响应是否为 Gemini 格式
 */
export function isGeminiErrorFormat(response: unknown): boolean {
  return detectErrorResponseFormat(response) === "gemini";
}

/**
 * 检查响应是否为 OpenAI 格式
 */
export function isOpenAIErrorFormat(response: unknown): boolean {
  return detectErrorResponseFormat(response) === "openai";
}
