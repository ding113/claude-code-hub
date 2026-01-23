import type { ParsedSSEEvent } from "@/types/message";

/**
 * 解析 SSE 流数据为结构化事件数组
 */
export function parseSSEData(sseText: string): ParsedSSEEvent[] {
  const events: ParsedSSEEvent[] = [];

  let eventName = "";
  let dataLines: string[] = [];

  const flushEvent = () => {
    // 修改：支持没有 event: 前缀的纯 data: 格式（Gemini 流式响应）
    // 如果没有 eventName，使用默认值 "message"
    if (dataLines.length === 0) {
      eventName = "";
      dataLines = [];
      return;
    }

    const dataStr = dataLines.join("\n");

    try {
      const data = JSON.parse(dataStr);
      events.push({ event: eventName || "message", data });
    } catch {
      events.push({ event: eventName || "message", data: dataStr });
    }

    eventName = "";
    dataLines = [];
  };

  const lines = sseText.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line) {
      flushEvent();
      continue;
    }

    if (line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      eventName = line.substring(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      let value = line.substring(5);
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }
      dataLines.push(value);
    }
  }

  flushEvent();

  return events;
}

/**
 * 严格检测文本是否“看起来像” SSE。
 *
 * 只认行首的 `event:` / `data:`（或前置注释行 `:`），避免 JSON 里包含 "data:" 误判。
 */
export function isSSEText(text: string): boolean {
  let start = 0;

  for (let i = 0; i <= text.length; i += 1) {
    if (i !== text.length && text.charCodeAt(i) !== 10) continue; // '\n'

    const line = text.slice(start, i).trim();
    start = i + 1;

    if (!line) continue;
    if (line.startsWith(":")) continue;

    return line.startsWith("event:") || line.startsWith("data:");
  }

  return false;
}

/**
 * 用于 UI 展示的 SSE 解析（在 parseSSEData 基础上做轻量清洗）。
 */
export function parseSSEDataForDisplay(sseText: string): ParsedSSEEvent[] {
  return parseSSEData(sseText).filter((evt) => {
    if (typeof evt.data !== "string") return true;
    return evt.data.trim() !== "[DONE]";
  });
}

/**
 * SSE 首块错误检测结果
 */
export interface SSEFirstBlockError {
  errorCode?: string;
  errorMessage: string;
  rawData: string;
}

/**
 * 检测 SSE 文本首个 event 是否为 error
 *
 * 支持的 error 格式：
 * 1. event: error + data: {...}
 * 2. 首个 data block 中包含 error 对象（type: "error" 或顶层 error 字段）
 *
 * @param sseText - SSE 文本（首块或完整）
 * @returns 如果是 error event，返回解析后的错误信息；否则返回 null
 */
export function detectSSEFirstBlockError(sseText: string): SSEFirstBlockError | null {
  const events = parseSSEData(sseText);

  if (events.length === 0) {
    return null;
  }

  const firstEvent = events[0];

  // 情况 1：显式的 event: error
  if (firstEvent.event === "error") {
    const data = firstEvent.data;
    if (typeof data === "object" && data !== null) {
      const errorObj = (data as Record<string, unknown>).error as
        | Record<string, unknown>
        | undefined;
      return {
        errorCode: (errorObj?.code as string | undefined) ?? (errorObj?.type as string | undefined),
        errorMessage:
          (errorObj?.message as string) ||
          ((data as Record<string, unknown>).message as string) ||
          "Unknown SSE error",
        rawData: sseText.slice(0, 500),
      };
    }
    return {
      errorMessage: typeof data === "string" ? data : "Unknown SSE error",
      rawData: sseText.slice(0, 500),
    };
  }

  // 情况 2：首个 data block 类型为 error（如 Claude 的 type: "error"）
  if (typeof firstEvent.data === "object" && firstEvent.data !== null) {
    const data = firstEvent.data as Record<string, unknown>;

    // 2.1: type: "error" 格式（Claude API 错误格式）
    if (data.type === "error") {
      const errorObj = data.error as Record<string, unknown> | undefined;
      return {
        errorCode: (errorObj?.type as string | undefined) ?? (data.code as string | undefined),
        errorMessage: (errorObj?.message as string) || (data.message as string) || "Unknown error",
        rawData: sseText.slice(0, 500),
      };
    }

    // 2.2: 顶层 error 字段（某些服务直接返回 data: {"error": {...}}）
    if (data.error && typeof data.error === "object") {
      const errorObj = data.error as Record<string, unknown>;
      return {
        errorCode: (errorObj.code as string | undefined) ?? (errorObj.type as string | undefined),
        errorMessage: (errorObj.message as string) || "Unknown SSE error",
        rawData: sseText.slice(0, 500),
      };
    }
  }

  return null;
}
