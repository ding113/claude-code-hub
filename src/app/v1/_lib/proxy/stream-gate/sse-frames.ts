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

export interface SseFrameParserOptions {
  maxBufferedCharacters?: number;
  bufferLimitExemption?: {
    /** 豁免帧仍受独立硬上限约束，避免特殊协议帧造成无界 retained buffer。 */
    maxBufferedCharacters: number;
    /** 只接收固定长度 data 头部，避免为了判定豁免复制完整大型帧。 */
    matches: (eventName: string | null, dataHead: string) => boolean;
  };
}

const DATA_HEAD_MAX_CHARACTERS = 64;
const LINE_HEAD_MAX_CHARACTERS = DATA_HEAD_MAX_CHARACTERS + "data: ".length;

export class SseFrameBufferLimitError extends Error {
  constructor(maxBufferedCharacters: number) {
    super(`SSE parser buffered data exceeded ${maxBufferedCharacters} characters`);
    this.name = "SseFrameBufferLimitError";
  }
}

export class SseFrameParser {
  private readonly decoder = new TextDecoder("utf-8");
  private lineParts: string[] = [];
  private lineCharacters = 0;
  private lineHead = "";
  private skipLeadingLf = false;
  private currentEvent: string | null = null;
  private dataLines: string[] = [];
  private dataCharacters = 0;
  private dataHead = "";

  constructor(private readonly options: SseFrameParserOptions = {}) {}

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
    const frames = this.consume(this.decoder.decode());
    this.skipLeadingLf = false;
    if (this.lineCharacters > 0) {
      // 尾部残行按一行处理（与既有校验器对无终止空行的流的行为一致）
      const frame = this.handleLine(this.takeLine());
      if (frame) frames.push(frame);
    }
    const last = this.flush();
    if (last) frames.push(last);
    return frames;
  }

  private consume(text: string): SseFrame[] {
    const frames: SseFrame[] = [];
    let start = 0;
    if (this.skipLeadingLf) {
      if (text.length === 0) return frames;
      if (text.charCodeAt(0) === 10) start = 1;
      this.skipLeadingLf = false;
    }

    for (let index = start; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code !== 10 && code !== 13) continue;

      this.appendLinePart(text.slice(start, index));
      const frame = this.handleLine(this.takeLine());
      if (frame) frames.push(frame);

      if (code === 13) {
        if (index + 1 < text.length && text.charCodeAt(index + 1) === 10) {
          index += 1;
        } else if (index === text.length - 1) {
          this.skipLeadingLf = true;
        }
      }
      start = index + 1;
    }

    this.appendLinePart(text.slice(start));
    this.assertBufferLimit();
    return frames;
  }

  private appendLinePart(part: string): void {
    if (part.length === 0) return;
    this.lineParts.push(part);
    this.lineCharacters += part.length;
    if (this.lineHead.length < LINE_HEAD_MAX_CHARACTERS) {
      this.lineHead += part.slice(0, LINE_HEAD_MAX_CHARACTERS - this.lineHead.length);
    }
  }

  private takeLine(): string {
    const line = this.lineParts.length === 1 ? this.lineParts[0] : this.lineParts.join("");
    this.lineParts = [];
    this.lineCharacters = 0;
    this.lineHead = "";
    return line ?? "";
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
      this.assertBufferLimit();
      return null;
    }
    if (line.startsWith("data:")) {
      const data = line.slice(5).replace(/^\s/, "");
      if (this.dataLines.length > 0) this.dataCharacters += 1;
      this.dataCharacters += data.length;
      this.dataLines.push(data);
      this.appendDataHead(data);
      this.assertBufferLimit();
      return null;
    }
    const candidate = line.trim();
    if (
      this.currentEvent === null &&
      this.dataLines.length === 0 &&
      (candidate.startsWith("{") || candidate.startsWith("["))
    ) {
      return { eventName: null, data: candidate };
    }
    // id: / retry: / 未知字段：忽略
    return null;
  }

  private flush(): SseFrame | null {
    const event = this.currentEvent;
    this.currentEvent = null;
    if (this.dataLines.length === 0) {
      this.dataHead = "";
      return null;
    }
    const data = this.dataLines.join("\n");
    this.dataLines = [];
    this.dataCharacters = 0;
    this.dataHead = "";
    return { eventName: event, data };
  }

  private appendDataHead(data: string): void {
    if (this.dataHead.length >= DATA_HEAD_MAX_CHARACTERS) return;
    if (this.dataLines.length > 1) this.dataHead += "\n";
    this.dataHead += data.slice(0, DATA_HEAD_MAX_CHARACTERS - this.dataHead.length);
  }

  private currentDataHead(): string {
    if (this.dataHead.length >= DATA_HEAD_MAX_CHARACTERS) return this.dataHead;
    if (!this.lineHead.startsWith("data:")) return this.dataHead;

    const tailData = this.lineHead.slice(5).replace(/^\s/, "");
    const separator = this.dataLines.length > 0 && this.dataHead.length > 0 ? "\n" : "";
    return `${this.dataHead}${separator}${tailData}`.slice(0, DATA_HEAD_MAX_CHARACTERS);
  }

  private resetRetainedState(): void {
    this.lineParts = [];
    this.lineCharacters = 0;
    this.lineHead = "";
    this.currentEvent = null;
    this.dataLines = [];
    this.dataCharacters = 0;
    this.dataHead = "";
    this.skipLeadingLf = false;
  }

  private assertBufferLimit(): void {
    const maxBufferedCharacters = this.options.maxBufferedCharacters;
    if (maxBufferedCharacters === undefined) return;

    const bufferedCharacters =
      this.lineCharacters + (this.currentEvent?.length ?? 0) + this.dataCharacters;
    if (bufferedCharacters <= maxBufferedCharacters) return;

    const exemption = this.options.bufferLimitExemption;
    if (
      exemption &&
      bufferedCharacters <= exemption.maxBufferedCharacters &&
      exemption.matches(this.currentEvent, this.currentDataHead())
    ) {
      return;
    }
    this.resetRetainedState();
    throw new SseFrameBufferLimitError(maxBufferedCharacters);
  }
}

/** 对完整 SSE body 一次性解析出全部帧。 */
export function parseSseBody(body: string): SseFrame[] {
  const parser = new SseFrameParser();
  return [...parser.pushText(body), ...parser.finish()];
}
