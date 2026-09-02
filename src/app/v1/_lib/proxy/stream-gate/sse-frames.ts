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

/** 返回 false 时立即停止解析当前输入；调用方随后不应复用该 parser。 */
export type SseFrameVisitor = (eventName: string | null, data: string) => boolean | undefined;

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
const TEXT_BLOCK_MAX_CHARACTERS = 64 * 1024;
const TEXT_BLOCK_MAX_PARTS = 4096;

/**
 * 把任意碎片输入维持在线性开销内，不为每个网络 chunk 或 data 行长期保留数组项。
 * 已归并的块在帧输出前不会被反复拼接。
 */
export class SegmentedTextBuffer {
  private blocks: string[] = [];
  private pending: string[] = [];
  private pendingCharacters = 0;
  private totalCharacters = 0;

  get length(): number {
    return this.totalCharacters;
  }

  append(value: string): void {
    if (value.length === 0) return;
    this.pending.push(value);
    this.pendingCharacters += value.length;
    this.totalCharacters += value.length;
    if (
      this.pendingCharacters >= TEXT_BLOCK_MAX_CHARACTERS ||
      this.pending.length >= TEXT_BLOCK_MAX_PARTS
    ) {
      this.flushPending();
    }
  }

  take(): string {
    this.flushPending();
    const value =
      this.blocks.length === 0
        ? ""
        : this.blocks.length === 1
          ? (this.blocks[0] ?? "")
          : this.blocks.join("");
    this.clear();
    return value;
  }

  clear(): void {
    this.blocks = [];
    this.pending = [];
    this.pendingCharacters = 0;
    this.totalCharacters = 0;
  }

  private flushPending(): void {
    if (this.pending.length === 0) return;
    this.blocks.push(this.pending.length === 1 ? (this.pending[0] ?? "") : this.pending.join(""));
    this.pending = [];
    this.pendingCharacters = 0;
  }
}

export class SseFrameBufferLimitError extends Error {
  constructor(maxBufferedCharacters: number) {
    super(`SSE parser buffered data exceeded ${maxBufferedCharacters} characters`);
    this.name = "SseFrameBufferLimitError";
  }
}

export class SseFrameParser {
  private readonly decoder = new TextDecoder("utf-8");
  private readonly lineBuffer = new SegmentedTextBuffer();
  private lineHead = "";
  private skipLeadingLf = false;
  private currentEvent: string | null = null;
  private readonly dataBuffer = new SegmentedTextBuffer();
  private dataLineCount = 0;
  private dataHead = "";

  constructor(private readonly options: SseFrameParserOptions = {}) {}

  /** 喂入一个网络 chunk，返回其中完成的帧（可能为空数组）。 */
  push(chunk: Uint8Array): SseFrame[] {
    const frames: SseFrame[] = [];
    this.visit(chunk, (eventName, data) => {
      frames.push({ eventName, data });
    });
    return frames;
  }

  /** 直接喂入已解码文本（供对完整 body 做一次性解析的调用方使用）。 */
  pushText(text: string): SseFrame[] {
    const frames: SseFrame[] = [];
    this.visitText(text, (eventName, data) => {
      frames.push({ eventName, data });
    });
    return frames;
  }

  /** 边解析边消费帧，避免热路径为单个大 chunk 构造完整 SseFrame 数组。 */
  visit(chunk: Uint8Array, visitor: SseFrameVisitor): boolean {
    return this.consume(this.decoder.decode(chunk, { stream: true }), visitor);
  }

  /** visit 的已解码文本版本。 */
  visitText(text: string, visitor: SseFrameVisitor): boolean {
    return this.consume(text, visitor);
  }

  /** 流终止：冲刷尾部未换行的行与未 dispatch 的帧。 */
  finish(): SseFrame[] {
    const frames: SseFrame[] = [];
    this.finishVisit((eventName, data) => {
      frames.push({ eventName, data });
    });
    return frames;
  }

  /** finish 的 visitor 版本。 */
  finishVisit(visitor: SseFrameVisitor): boolean {
    if (!this.consume(this.decoder.decode(), visitor)) return false;
    this.skipLeadingLf = false;
    if (this.lineBuffer.length > 0) {
      // 尾部残行按一行处理（与既有校验器对无终止空行的流的行为一致）
      if (!this.handleLine(this.takeLine(), visitor)) return false;
    }
    return this.flush(visitor);
  }

  private consume(text: string, visitor: SseFrameVisitor): boolean {
    let start = 0;
    if (this.skipLeadingLf) {
      if (text.length === 0) return true;
      if (text.charCodeAt(0) === 10) start = 1;
      this.skipLeadingLf = false;
    }

    for (let index = start; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code !== 10 && code !== 13) continue;

      this.appendLinePart(text.slice(start, index));
      // 完整行也必须在合并碎片前执行上限检查；否则带换行的超长未知字段
      // 会绕过行尾的 retained-state 检查，并在 take() 中制造一次大字符串。
      this.assertBufferLimit(
        this.currentEventNameForCompletedLine(),
        this.currentDataHead(),
        this.completedLineSyntaxCharacters(),
        this.lineHead.startsWith("event:")
      );
      if (!this.handleLine(this.takeLine(), visitor)) return false;

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
    return true;
  }

  private appendLinePart(part: string): void {
    if (part.length === 0) return;
    this.lineBuffer.append(part);
    if (this.lineHead.length < LINE_HEAD_MAX_CHARACTERS) {
      this.lineHead += part.slice(0, LINE_HEAD_MAX_CHARACTERS - this.lineHead.length);
    }
  }

  private takeLine(): string {
    const line = this.lineBuffer.take();
    this.lineHead = "";
    return line;
  }

  private handleLine(line: string, visitor: SseFrameVisitor): boolean {
    if (line.length === 0) {
      return this.flush(visitor);
    }
    if (line.startsWith(":")) {
      return true; // SSE 注释
    }
    if (line.startsWith("event:")) {
      this.currentEvent = line.slice(6).trim();
      this.assertBufferLimit();
      return true;
    }
    if (line.startsWith("data:")) {
      const data = line.slice(5).replace(/^\s/, "");
      if (this.dataLineCount > 0) this.dataBuffer.append("\n");
      this.dataBuffer.append(data);
      this.dataLineCount += 1;
      this.appendDataHead(data);
      this.assertBufferLimit();
      return true;
    }
    const candidate = line.trim();
    if (
      this.currentEvent === null &&
      this.dataLineCount === 0 &&
      (candidate.startsWith("{") || candidate.startsWith("["))
    ) {
      return visitor(null, candidate) !== false;
    }
    // id: / retry: / 未知字段：忽略
    return true;
  }

  private flush(visitor: SseFrameVisitor): boolean {
    const event = this.currentEvent;
    this.currentEvent = null;
    if (this.dataLineCount === 0) {
      this.dataHead = "";
      return true;
    }
    const data = this.dataBuffer.take();
    this.dataLineCount = 0;
    this.dataHead = "";
    return visitor(event, data) !== false;
  }

  private appendDataHead(data: string): void {
    if (this.dataHead.length >= DATA_HEAD_MAX_CHARACTERS) return;
    if (this.dataLineCount > 1) this.dataHead += "\n";
    this.dataHead += data.slice(0, DATA_HEAD_MAX_CHARACTERS - this.dataHead.length);
  }

  private currentDataHead(): string {
    if (this.dataHead.length >= DATA_HEAD_MAX_CHARACTERS) return this.dataHead;
    if (!this.lineHead.startsWith("data:")) return this.dataHead;

    const tailData = this.lineHead.slice(5).replace(/^\s/, "");
    const separator = this.dataLineCount > 0 && this.dataHead.length > 0 ? "\n" : "";
    return `${this.dataHead}${separator}${tailData}`.slice(0, DATA_HEAD_MAX_CHARACTERS);
  }

  private currentEventNameForCompletedLine(): string | null {
    if (!this.lineHead.startsWith("event:")) return this.currentEvent;
    return this.lineHead.slice(6).trim();
  }

  private completedLineSyntaxCharacters(): number {
    const fieldCharacters = this.lineHead.startsWith("data:")
      ? 5
      : this.lineHead.startsWith("event:")
        ? 6
        : 0;
    if (fieldCharacters === 0) return 0;
    return fieldCharacters + (this.lineHead[fieldCharacters] === " " ? 1 : 0);
  }

  private resetRetainedState(): void {
    this.lineBuffer.clear();
    this.lineHead = "";
    this.currentEvent = null;
    this.dataBuffer.clear();
    this.dataLineCount = 0;
    this.dataHead = "";
    this.skipLeadingLf = false;
  }

  private assertBufferLimit(
    candidateEventName = this.currentEvent,
    candidateHead = this.currentDataHead(),
    ignoredLineSyntaxCharacters = 0,
    replacesCurrentEvent = false
  ): void {
    const maxBufferedCharacters = this.options.maxBufferedCharacters;
    if (maxBufferedCharacters === undefined) return;

    const bufferedCharacters =
      Math.max(0, this.lineBuffer.length - ignoredLineSyntaxCharacters) +
      (replacesCurrentEvent ? 0 : (this.currentEvent?.length ?? 0)) +
      this.dataBuffer.length;
    if (bufferedCharacters <= maxBufferedCharacters) return;

    const exemption = this.options.bufferLimitExemption;
    if (
      exemption &&
      bufferedCharacters <= exemption.maxBufferedCharacters &&
      exemption.matches(candidateEventName, candidateHead)
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
