import { type FrameVerdict, isRequestEchoFrame, type ProtocolFamily } from "./frame-classifier";
import { createFrameProbe } from "./frame-probe";
import { SseFrameBufferLimitError, type SseFrameVisitor } from "./sse-frames";

/** 原始字节交给 PrefixStore；此处只保留协议事实和最多 2 KiB 错误预览。 */
export class ProbedSseFrames {
  private decoder = new TextDecoder();
  private probe: ReturnType<typeof createFrameProbe>;
  private field = "";
  private inValue = false;
  private firstValue = false;
  private lineLength = 0;
  private lineStart = true;
  private leadingWhitespace = false;
  private bare = false;
  private eventValue = "";
  private eventOverflow = false;
  private event: string | null = null;
  private skipLf = false;
  private dataLines = 0;
  private dataLength = 0;
  private dataBytes = 0;
  private trailingLength = 0;
  private trailingBytes = 0;
  private preview = "";
  private inferencePreview = "";
  lastFrame: {
    verdict: FrameVerdict;
    acceptTerminal: boolean;
    dataBytes: number;
    echo: boolean;
    inferenceText: string;
  } | null = null;

  constructor(
    private readonly family: ProtocolFamily,
    private readonly cap: number,
    private readonly reserveDepth?: (bytes: number) => void
  ) {
    this.probe = createFrameProbe(family, reserveDepth);
  }

  visit(chunk: Uint8Array, visitor: SseFrameVisitor): boolean {
    // 限制一次 TextDecoder 临时字符串的大小，视图只在本次同步调用中存活。
    for (let offset = 0; offset < chunk.byteLength; offset += 16 * 1024) {
      if (
        !this.consume(
          this.decoder.decode(chunk.subarray(offset, offset + 16 * 1024), { stream: true }),
          visitor
        )
      )
        return false;
    }
    return true;
  }
  finishVisit(visitor: SseFrameVisitor): boolean {
    if (!this.consume(this.decoder.decode(), visitor)) return false;
    if (this.lineLength > 0 && !this.endLine(visitor)) return false;
    return this.flush(visitor);
  }
  private consume(text: string, visitor: SseFrameVisitor): boolean {
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (this.skipLf) {
        this.skipLf = false;
        if (c === "\n") {
          start = i + 1;
          continue;
        }
      }
      if (c !== "\r" && c !== "\n") continue;
      this.part(text.slice(start, i));
      if (!this.endLine(visitor)) return false;
      this.skipLf = c === "\r";
      start = i + 1;
    }
    this.part(text.slice(start));
    return true;
  }
  private part(part: string): void {
    this.lineLength += part.length;
    if (this.lineStart && part.length > 0) {
      const candidate = part.trimStart();
      if (!candidate) {
        this.leadingWhitespace = true;
        this.assertLimit();
        return;
      }
      this.lineStart = false;
      this.bare =
        this.event === null &&
        this.dataLines === 0 &&
        (candidate[0] === "{" || candidate[0] === "[");
      if (this.bare) {
        this.dataLines = 1;
        this.data(candidate);
        this.assertLimit();
        return;
      }
      // SSE 字段必须从行首开始；前导空白只允许裸 JSON 兼容路径。
      if (this.leadingWhitespace || candidate.length !== part.length) this.field = "\u0000ignored";
    }
    if (this.bare) {
      this.data(part);
      this.assertLimit();
      return;
    }
    let offset = 0;
    if (!this.inValue) {
      for (; offset < part.length; offset++) {
        if (part[offset] === ":") {
          this.inValue = true;
          this.firstValue = true;
          offset++;
          this.startValue();
          break;
        }
        if (this.field.length < 16) this.field += part[offset];
      }
    }
    if (this.inValue && offset < part.length) {
      if (this.firstValue && part[offset].trim() === "") offset++;
      this.firstValue = false;
      const value = part.slice(offset);
      if (this.field === "data") this.data(value);
      else if (this.field === "event") {
        const candidate = this.eventValue ? value : value.trimStart();
        const remaining = 256 - this.eventValue.length;
        if (candidate.slice(remaining).trim() !== "") this.eventOverflow = true;
        if (this.eventValue.length < 256)
          this.eventValue += (this.eventValue ? value : value.trimStart()).slice(
            0,
            256 - this.eventValue.length
          );
      }
    }
    this.assertLimit();
  }
  private assertLimit(): void {
    const max = isRequestEchoFrame(this.family, this.event, this.preview) ? this.cap * 2 : this.cap;
    if (this.dataLength > max || this.lineLength > max + 8) throw new SseFrameBufferLimitError(max);
  }
  private startValue(): void {
    if (this.field === "data") {
      if (this.dataLines++ > 0) this.data("\n");
    }
  }
  private data(value: string): void {
    if (this.bare) {
      const trimmedLength = value.trimEnd().length;
      if (trimmedLength > 0) {
        this.trailingLength = 0;
        this.trailingBytes = 0;
      }
      this.trailingLength += value.length - trimmedLength;
      this.trailingBytes += Buffer.byteLength(value.slice(trimmedLength), "utf8");
    }
    this.dataLength += value.length;
    this.dataBytes += Buffer.byteLength(value, "utf8");
    if (this.preview.length < 2000) this.preview += value.slice(0, 2000 - this.preview.length);
    if (this.inferencePreview.length < 64 * 1024) {
      const candidate = this.inferencePreview ? value : value.trimStart();
      this.inferencePreview += candidate.slice(0, 64 * 1024 - this.inferencePreview.length);
    }
    this.probe.feed(value);
  }
  private endLine(visitor: SseFrameVisitor): boolean {
    const empty = this.lineLength === 0;
    const bare = this.bare;
    if (bare) {
      this.dataLength -= this.trailingLength;
      this.dataBytes -= this.trailingBytes;
      this.preview = this.preview.slice(0, this.dataLength);
      this.inferencePreview = this.inferencePreview.slice(0, this.dataLength);
    }
    if (this.field === "event")
      this.event = this.eventOverflow ? "\u0000unknown-event" : this.eventValue.trim();
    this.lineLength = 0;
    this.lineStart = true;
    this.leadingWhitespace = false;
    this.bare = false;
    this.field = "";
    this.inValue = false;
    this.firstValue = false;
    this.eventValue = "";
    this.eventOverflow = false;
    return empty || bare ? this.flush(visitor) : true;
  }
  private flush(visitor: SseFrameVisitor): boolean {
    let keepGoing = true;
    if (this.dataLines > 0) {
      this.lastFrame = {
        ...this.probe.finish(this.event, this.preview, this.dataLength),
        dataBytes: this.dataBytes,
        echo: isRequestEchoFrame(this.family, this.event, this.preview),
        inferenceText: this.inferencePreview,
      };
      keepGoing = visitor(this.event, this.preview) !== false;
      this.lastFrame.inferenceText = "";
    }
    this.event = null;
    this.dataLines = 0;
    this.dataLength = 0;
    this.dataBytes = 0;
    this.trailingLength = 0;
    this.trailingBytes = 0;
    this.preview = "";
    this.inferencePreview = "";
    this.probe = createFrameProbe(this.family, this.reserveDepth);
    return keepGoing;
  }
}
