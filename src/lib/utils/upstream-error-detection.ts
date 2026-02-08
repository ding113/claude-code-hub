import { parseSSEData } from "@/lib/utils/sse";

export type UpstreamErrorDetectionResult =
  | { isError: false }
  | {
      isError: true;
      reason: string;
    };

type DetectionOptions = {
  /**
   * 仅对小体积 JSON 启用 message 关键字检测，避免误判与无谓开销
   */
  maxJsonCharsForMessageCheck?: number;
  /**
   * message 关键字匹配规则（默认 /error/i）
   */
  messageKeyword?: RegExp;
};

const DEFAULT_MAX_JSON_CHARS_FOR_MESSAGE_CHECK = 1000;
const DEFAULT_MESSAGE_KEYWORD = /error/i;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasNonEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return !Number.isNaN(value) && value !== 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function truncateForReason(text: string, maxLen: number = 200): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

function detectFromJsonObject(
  obj: Record<string, unknown>,
  rawJsonChars: number,
  options: Required<Pick<DetectionOptions, "maxJsonCharsForMessageCheck" | "messageKeyword">>
): UpstreamErrorDetectionResult {
  const errorValue = obj.error;
  if (hasNonEmptyValue(errorValue)) {
    // 优先展示 string 或 error.message，避免把整个对象塞进 reason
    if (typeof errorValue === "string") {
      return {
        isError: true,
        reason: `上游返回 200 但 JSON.error 非空: ${truncateForReason(errorValue)}`,
      };
    }

    if (isPlainRecord(errorValue) && typeof errorValue.message === "string") {
      return {
        isError: true,
        reason: `上游返回 200 但 JSON.error.message 非空: ${truncateForReason(errorValue.message)}`,
      };
    }

    return { isError: true, reason: "上游返回 200 但 JSON.error 非空" };
  }

  if (rawJsonChars < options.maxJsonCharsForMessageCheck) {
    const message =
      typeof obj.message === "string"
        ? obj.message
        : isPlainRecord(obj.error) && typeof obj.error.message === "string"
          ? obj.error.message
          : null;

    if (message && options.messageKeyword.test(message)) {
      return {
        isError: true,
        reason: `上游返回 200 但 JSON.message 命中关键字: ${truncateForReason(message)}`,
      };
    }
  }

  return { isError: false };
}

/**
 * 用于“流式 SSE 已经结束后”的补充检查：
 * - 响应体为空：视为错误
 * - JSON 里包含非空 error 字段：视为错误
 * - 小于 1000 字符的 JSON：若 message（或 error.message）包含 "error" 字样：视为错误
 */
export function detectUpstreamErrorFromSseOrJsonText(
  text: string,
  options: DetectionOptions = {}
): UpstreamErrorDetectionResult {
  const merged: Required<Pick<DetectionOptions, "maxJsonCharsForMessageCheck" | "messageKeyword">> = {
    maxJsonCharsForMessageCheck:
      options.maxJsonCharsForMessageCheck ?? DEFAULT_MAX_JSON_CHARS_FOR_MESSAGE_CHECK,
    messageKeyword: options.messageKeyword ?? DEFAULT_MESSAGE_KEYWORD,
  };

  const trimmed = text.trim();
  if (!trimmed) {
    return { isError: true, reason: "上游返回 200 但响应体为空" };
  }

  // 情况 1：纯 JSON（上游可能 Content-Type 设置为 SSE，但实际上返回 JSON）
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isPlainRecord(parsed)) {
        return detectFromJsonObject(parsed, trimmed.length, merged);
      }
    } catch {
      // JSON 解析失败：不视为错误，交由上层逻辑处理
    }
    return { isError: false };
  }

  // 情况 2：SSE 文本。快速过滤：既无 "error" 也无 "message" key 时跳过解析
  // 注意：这里用 key 形式的引号匹配，尽量避免 assistant 正文里出现 "error" 造成的无谓解析
  if (!text.includes("\"error\"") && !text.includes("\"message\"")) {
    return { isError: false };
  }

  const events = parseSSEData(text);
  for (const evt of events) {
    if (!isPlainRecord(evt.data)) continue;
    let chars = 0;
    try {
      chars = JSON.stringify(evt.data).length;
    } catch {
      // ignore
    }

    const res = detectFromJsonObject(evt.data, chars, merged);
    if (res.isError) return res;
  }

  return { isError: false };
}

