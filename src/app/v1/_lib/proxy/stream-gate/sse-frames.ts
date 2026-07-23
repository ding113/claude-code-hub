/**
 * 增量 SSE 分帧器。
 *
 * 面向流式内容门控与 fake-streaming 校验器共享：把任意切分的字节流
 * 还原成完整的 SSE 帧（event 名 + data 载荷），容忍：
 * - 任意网络切分（帧/行/UTF-8 码点跨 chunk 边界）
 * - LF 与 CRLF 行尾（含 CR 落在 chunk 末尾的跨块场景）
 * - 注释行（`:` 开头）、多行 `data:`、`id:`/`retry:` 等无关字段
 *
 * 帧边界语义与既有 fake-streaming 校验器保持一致：
 * - 空行触发 dispatch；无 data 行的事件不产出帧（但会重置 event 名）
 * - `event:` 值 trim；`data:` 仅剥一个前导空白
 */

export interface SseFrame {
  /** SSE event 字段值；未出现时为 null */
  eventName: string | null;
  /** 多行 data 以 \n 连接后的原始载荷（未 trim） */
  data: string;
}

export class SseFrameParser {
  private readonly decoder = new TextDecoder("utf-8");
  private lineTail = "";
  private currentEvent: string | null = null;
  private dataLines: string[] = [];

  /** 喂入一个网络 chunk，返回其中完成的帧（可能为空数组）。 */
  push(chunk: Uint8Array): SseFrame[] {
    return this.consume(this.decoder.decode(chunk, { stream: true }));
  }

  /** 直接喂入已解码文本（供对完整 body 做一次性解析的调用方使用）。 */
  pushText(text: string): SseFrame[] {
    return this.consume(text);
  }

  /** 流终止：冲刷尾部未换行的行与未 dispatch 的帧。 */
  finish(): SseFrame[] {
    const frames: SseFrame[] = [];
    const tail = this.lineTail + this.decoder.decode();
    this.lineTail = "";
    if (tail.length > 0) {
      // 尾部残行按一行处理（与既有校验器对无终止空行的流的行为一致）
      const frame = this.handleLine(stripTrailingCr(tail));
      if (frame) frames.push(frame);
    }
    const last = this.flush();
    if (last) frames.push(last);
    return frames;
  }

  private consume(text: string): SseFrame[] {
    const frames: SseFrame[] = [];
    let buffer = this.lineTail + text;
    // CR 落在末尾时可能是被切开的 CRLF，留到下一个 chunk 再判
    let holdCr = false;
    if (buffer.endsWith("\r")) {
      buffer = buffer.slice(0, -1);
      holdCr = true;
    }
    const lines = buffer.split(/\r\n|\n|\r/);
    // 最后一段是未完成行，保留
    this.lineTail = (lines.pop() ?? "") + (holdCr ? "\r" : "");
    for (const line of lines) {
      const frame = this.handleLine(line);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  private handleLine(line: string): SseFrame | null {
    if (line.length === 0) {
      return this.flush();
    }
    if (line.startsWith(":")) {
      return null; // SSE 注释
    }
    if (line.startsWith("event:")) {
      this.currentEvent = line.slice(6).trim();
      return null;
    }
    if (line.startsWith("data:")) {
      this.dataLines.push(line.slice(5).replace(/^\s/, ""));
      return null;
    }
    // id: / retry: / 未知字段：忽略
    return null;
  }

  private flush(): SseFrame | null {
    const event = this.currentEvent;
    this.currentEvent = null;
    if (this.dataLines.length === 0) {
      return null;
    }
    const data = this.dataLines.join("\n");
    this.dataLines = [];
    return { eventName: event, data };
  }
}

function stripTrailingCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** 对完整 SSE body 一次性解析出全部帧。 */
export function parseSseBody(body: string): SseFrame[] {
  const parser = new SseFrameParser();
  return [...parser.pushText(body), ...parser.finish()];
}
