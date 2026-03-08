/**
 * Response Input Rectifier
 *
 * OpenAI Responses API (/v1/responses) 的 input 字段支持多种格式:
 * - 字符串简写: "hello"
 * - 单对象: { role: "user", content: [...] }
 * - 数组 (标准): [{ role: "user", content: [...] }]
 *
 * 下游代码 (format detection, converters) 要求 input 为数组。
 * 此整流器在 guard pipeline 之前将非数组 input 规范化为数组格式。
 */

import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { logger } from "@/lib/logger";
import type { ProxySession } from "./session";

export type ResponseInputRectifierAction =
  | "string_to_array"
  | "object_to_array"
  | "empty_string_to_empty_array"
  | "passthrough";

export type ResponseInputRectifierResult = {
  applied: boolean;
  action: ResponseInputRectifierAction;
  originalType: "string" | "object" | "array" | "other";
};

/**
 * 规范化 Response API 请求体的 input 字段。
 * 原地修改 message 对象（与现有整流器约定一致）。
 */
export function rectifyResponseInput(
  message: Record<string, unknown>
): ResponseInputRectifierResult {
  const input = message.input;

  // Case 1: 数组 -- passthrough
  if (Array.isArray(input)) {
    return { applied: false, action: "passthrough", originalType: "array" };
  }

  // Case 2: 字符串
  if (typeof input === "string") {
    if (input === "") {
      message.input = [];
      return { applied: true, action: "empty_string_to_empty_array", originalType: "string" };
    }

    message.input = [
      {
        role: "user",
        content: [{ type: "input_text", text: input }],
      },
    ];
    return { applied: true, action: "string_to_array", originalType: "string" };
  }

  // Case 3: 单对象 (MessageInput 有 role, ToolOutputsInput 有 type)
  if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;
    if ("role" in obj || "type" in obj) {
      message.input = [input];
      return { applied: true, action: "object_to_array", originalType: "object" };
    }
  }

  // Case 4: undefined/null/其他 -- passthrough，让下游处理错误
  return {
    applied: false,
    action: "passthrough",
    originalType: input === undefined || input === null ? "other" : "other",
  };
}

/**
 * 入口：检查系统设置，执行整流，记录审计。
 * 在 proxy-handler.ts 中格式检测确认 "response" 后调用。
 */
export async function normalizeResponseInput(session: ProxySession): Promise<void> {
  const settings = await getCachedSystemSettings();
  const enabled = settings.enableResponseInputRectifier ?? true;

  if (!enabled) {
    return;
  }

  const message = session.request.message as Record<string, unknown>;
  const result = rectifyResponseInput(message);

  if (result.applied) {
    session.addSpecialSetting({
      type: "response_input_rectifier",
      scope: "request",
      hit: true,
      action: result.action,
      originalType: result.originalType,
    });

    logger.info("[ResponseInputRectifier] Input normalized", {
      action: result.action,
      originalType: result.originalType,
      sessionId: session.sessionId,
    });
  }
}
