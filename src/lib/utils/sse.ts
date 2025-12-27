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
