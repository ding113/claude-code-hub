/**
 * 错误覆写响应验证工具
 *
 * 提供统一的 JSON 结构验证，防止纯文本或畸形数据透传给客户端。
 * 在规则加载阶段和运行时响应阶段复用同一验证逻辑。
 */

import type { ErrorOverrideResponse } from "@/repository/error-rules";

/** 覆写响应体最大字节数限制 (10KB) */
const MAX_OVERRIDE_RESPONSE_BYTES = 10 * 1024;

/**
 * 验证错误覆写响应的 JSON 结构是否合法（返回具体错误消息）
 *
 * 必须满足的结构：
 * {
 *   "type": "error",
 *   "error": {
 *     "type": string,
 *     "message": string
 *   }
 * }
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

  // 顶层 type 必须为 "error"
  if (typeof obj.type !== "string" || obj.type.trim().length === 0) {
    return "覆写响应缺少 type 字段";
  }
  if (obj.type !== "error") {
    return '覆写响应 type 字段必须为 "error"';
  }

  // error 对象存在且不是数组
  if (!obj.error || typeof obj.error !== "object" || Array.isArray(obj.error)) {
    return "覆写响应缺少 error 对象";
  }

  const errorObj = obj.error as Record<string, unknown>;

  if (typeof errorObj.type !== "string" || errorObj.type.trim().length === 0) {
    return "覆写响应 error.type 字段缺失或为空";
  }

  // message 允许为空字符串，运行时将回退到原始错误消息
  if (typeof errorObj.message !== "string") {
    return "覆写响应 error.message 字段必须是字符串";
  }

  if (obj.request_id !== undefined && typeof obj.request_id !== "string") {
    return "覆写响应 request_id 字段必须是字符串";
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
