import { getCachedSystemSettings } from "@/lib/config";
import { logger } from "@/lib/logger";
import { SessionManager } from "@/lib/session-manager";
import { updateMessageRequestDetails } from "@/repository/message";
import type { ResponseFixerSpecialSetting } from "@/types/special-settings";
import type { ResponseFixerConfig } from "@/types/system-config";
import type { ProxySession } from "../session";
import { EncodingFixer } from "./encoding-fixer";
import { JsonFixer } from "./json-fixer";
import { SseFixer } from "./sse-fixer";

type ResponseFixerApplied = {
  encoding: { applied: boolean; details?: string };
  sse: { applied: boolean; details?: string };
  json: { applied: boolean; details?: string };
};

const DEFAULT_CONFIG: ResponseFixerConfig = {
  fixTruncatedJson: true,
  fixSseFormat: true,
  fixEncoding: true,
  maxJsonDepth: 200,
  maxFixSize: 1024 * 1024,
};

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function toArrayBufferUint8Array(input: Uint8Array): Uint8Array<ArrayBuffer> {
  // Response/BodyInit 在 DOM 类型中要求 ArrayBufferView（buffer 为 ArrayBuffer），这里避免 SharedArrayBuffer 类型污染
  if (input.buffer instanceof ArrayBuffer) {
    return input as Uint8Array<ArrayBuffer>;
  }
  return new Uint8Array(input);
}

function cleanResponseHeaders(headers: Headers): Headers {
  const cleaned = new Headers(headers);
  cleaned.delete("transfer-encoding");
  cleaned.delete("content-length");
  return cleaned;
}

const LF_BYTE = 0x0a;
const CR_BYTE = 0x0d;

const SSE_DATA_PREFIX = [0x64, 0x61, 0x74, 0x61, 0x3a] as const; // data:
const SSE_DATA_PREFIX_WITH_SPACE = new Uint8Array([0x64, 0x61, 0x74, 0x61, 0x3a, 0x20]); // data:␠
const LF_BYTES = new Uint8Array([LF_BYTE]);

function concatUint8Chunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

class ChunkBuffer {
  private readonly chunks: Uint8Array[] = [];
  private head = 0;
  private headOffset = 0;
  private total = 0;
  private processableEnd = 0;
  private pendingCR = false;

  get length(): number {
    return this.total;
  }

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    const prevTotal = this.total;
    this.chunks.push(chunk);
    this.total += chunk.length;

    // 解决跨 chunk 的 CRLF：如果上一块以 CR 结尾，需要看本块的首字节是否为 LF
    if (this.pendingCR) {
      this.processableEnd = chunk[0] === LF_BYTE ? prevTotal + 1 : prevTotal;
      this.pendingCR = false;
    }

    // 仅扫描新增 chunk，增量维护“可处理末尾”索引，避免每次全量回扫导致 O(n^2)
    for (let i = 0; i < chunk.length; i += 1) {
      const b = chunk[i];
      if (b === LF_BYTE) {
        this.processableEnd = prevTotal + i + 1;
        continue;
      }
      if (b !== CR_BYTE) continue;

      if (i + 1 < chunk.length) {
        if (chunk[i + 1] !== LF_BYTE) {
          this.processableEnd = prevTotal + i + 1;
        }
        continue;
      }

      // chunk 尾部 CR：等待下一块是否为 CRLF
      this.pendingCR = true;
    }
  }

  clear(): void {
    this.chunks.length = 0;
    this.head = 0;
    this.headOffset = 0;
    this.total = 0;
    this.processableEnd = 0;
    this.pendingCR = false;
  }

  flushTo(controller: TransformStreamDefaultController<Uint8Array>): void {
    for (let i = this.head; i < this.chunks.length; i += 1) {
      const chunk = this.chunks[i];
      if (i === this.head && this.headOffset > 0) {
        const view = chunk.subarray(this.headOffset);
        if (view.length > 0) controller.enqueue(view);
        continue;
      }
      controller.enqueue(chunk);
    }
    this.clear();
  }

  findProcessableEnd(): number {
    if (this.total === 0) return 0;
    // 保持历史行为：末尾 CR 时不切分，等待下一块确认是否为 CRLF
    if (this.pendingCR) return 0;
    return this.processableEnd;
  }

  take(size: number): Uint8Array {
    if (size <= 0) return new Uint8Array(0);
    if (size > this.total) {
      throw new Error("ChunkBuffer.take size exceeds buffered length");
    }

    const out = new Uint8Array(size);
    let outOffset = 0;

    while (outOffset < size) {
      const chunk = this.chunks[this.head];
      const available = chunk.length - this.headOffset;
      const toCopy = Math.min(available, size - outOffset);
      out.set(chunk.subarray(this.headOffset, this.headOffset + toCopy), outOffset);

      outOffset += toCopy;
      this.headOffset += toCopy;
      this.total -= toCopy;

      if (this.headOffset >= chunk.length) {
        this.head += 1;
        this.headOffset = 0;
      }
    }

    if (this.head > 64) {
      this.chunks.splice(0, this.head);
      this.head = 0;
    }

    this.processableEnd = Math.max(0, this.processableEnd - size);
    return out;
  }

  drain(): Uint8Array {
    const out = this.take(this.total);
    this.clear();
    return out;
  }
}

function persistSpecialSettings(session: ProxySession): void {
  const specialSettings = session.getSpecialSettings();
  if (!specialSettings || specialSettings.length === 0) return;

  if (session.sessionId) {
    void SessionManager.storeSessionSpecialSettings(
      session.sessionId,
      specialSettings,
      session.requestSequence
    ).catch((err) => {
      logger.error("[ResponseFixer] Failed to store special settings", {
        error: err,
        sessionId: session.sessionId,
      });
    });
  }

  if (session.messageContext?.id) {
    void updateMessageRequestDetails(session.messageContext.id, {
      specialSettings,
    }).catch((err) => {
      logger.error("[ResponseFixer] Failed to persist special settings", {
        error: err,
        messageRequestId: session.messageContext?.id,
      });
    });
  }
}

export class ResponseFixer {
  static async process(session: ProxySession, response: Response): Promise<Response> {
    const settings = await getCachedSystemSettings();

    const enabled = settings.enableResponseFixer ?? true;
    if (!enabled) {
      return response;
    }

    const config: ResponseFixerConfig = settings.responseFixerConfig ?? DEFAULT_CONFIG;

    const contentType = response.headers.get("content-type") || "";
    const isSse = contentType.includes("text/event-stream");

    if (isSse && response.body) {
      return ResponseFixer.processStream(session, response, config);
    }

    return await ResponseFixer.processNonStream(session, response, config);
  }

  private static async processNonStream(
    session: ProxySession,
    response: Response,
    config: ResponseFixerConfig
  ): Promise<Response> {
    const startedAt = nowMs();
    const applied: ResponseFixerApplied = {
      encoding: { applied: false },
      sse: { applied: false },
      json: { applied: false },
    };

    const audit: ResponseFixerSpecialSetting = {
      type: "response_fixer",
      scope: "response",
      hit: false,
      fixersApplied: [],
      totalBytesProcessed: 0,
      processingTimeMs: 0,
    };

    const originalBody: Uint8Array = new Uint8Array(await response.arrayBuffer());
    audit.totalBytesProcessed = originalBody.length;

    let data: Uint8Array = originalBody;

    if (config.fixEncoding) {
      const res = new EncodingFixer().fix(data);
      if (res.applied) {
        applied.encoding.applied = true;
        applied.encoding.details = res.details;
        data = res.data;
      }
    }

    if (config.fixTruncatedJson) {
      const res = new JsonFixer({ maxDepth: config.maxJsonDepth, maxSize: config.maxFixSize }).fix(
        data
      );
      if (res.applied) {
        applied.json.applied = true;
        applied.json.details = res.details;
        data = res.data;
      }
    }

    audit.hit = applied.encoding.applied || applied.json.applied;
    audit.processingTimeMs = Math.max(0, Math.round(nowMs() - startedAt));
    audit.fixersApplied = ResponseFixer.buildFixersApplied(applied, false);

    if (audit.hit) {
      session.addSpecialSetting(audit);
      persistSpecialSettings(session);
    }

    const headers = cleanResponseHeaders(response.headers);
    headers.set("x-cch-response-fixer", audit.hit ? "applied" : "not-applied");

    return new Response(toArrayBufferUint8Array(data), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  private static processStream(
    session: ProxySession,
    response: Response,
    config: ResponseFixerConfig
  ): Response {
    const startedAt = nowMs();
    const applied: ResponseFixerApplied = {
      encoding: { applied: false },
      sse: { applied: false },
      json: { applied: false },
    };

    const audit: ResponseFixerSpecialSetting = {
      type: "response_fixer",
      scope: "response",
      hit: false,
      fixersApplied: [],
      totalBytesProcessed: 0,
      processingTimeMs: 0,
    };

    const encodingFixer = config.fixEncoding ? new EncodingFixer() : null;
    const sseFixer = config.fixSseFormat ? new SseFixer() : null;
    const jsonFixer = config.fixTruncatedJson
      ? new JsonFixer({ maxDepth: config.maxJsonDepth, maxSize: config.maxFixSize })
      : null;

    const buffer = new ChunkBuffer();
    let passthrough = false;
    const maxBufferBytes = config.maxFixSize;

    const headers = cleanResponseHeaders(response.headers);
    // 流式响应无法在返回 Response 时准确判断是否发生了“实际修复”（需要读完整流）。
    // 这里使用“processed”表示已启用并参与处理；真实命中情况以 specialSettings 审计为准。
    headers.set("x-cch-response-fixer", "processed");

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        audit.totalBytesProcessed += chunk.length;

        if (passthrough) {
          controller.enqueue(chunk);
          return;
        }

        // 安全保护：如果上游长时间不输出换行，buffer 会持续增长，可能导致内存无界增长。
        // 达到上限后降级为透传（不再进行 SSE/JSON 修复），避免 DoS 风险。
        if (buffer.length + chunk.length > maxBufferBytes) {
          passthrough = true;
          buffer.flushTo(controller);
          controller.enqueue(chunk);
          return;
        }

        buffer.push(chunk);

        const end = buffer.findProcessableEnd();
        if (end <= 0) {
          return;
        }

        const toProcess = buffer.take(end);

        let data: Uint8Array = toProcess;

        if (encodingFixer) {
          const res = encodingFixer.fix(data);
          if (res.applied) {
            applied.encoding.applied = true;
            applied.encoding.details ??= res.details;
            data = res.data;
          }
        }

        if (sseFixer) {
          const res = sseFixer.fix(data);
          if (res.applied) {
            applied.sse.applied = true;
            applied.sse.details ??= res.details;
            data = res.data;
          }
        }

        if (jsonFixer) {
          const res = ResponseFixer.fixSseJsonLines(data, jsonFixer);
          if (res.applied) {
            applied.json.applied = true;
            applied.json.details ??= res.details;
            data = res.data;
          }
        }

        controller.enqueue(data);
      },
      flush(controller) {
        if (buffer.length > 0) {
          let data: Uint8Array = buffer.drain();

          if (encodingFixer) {
            const res = encodingFixer.fix(data);
            if (res.applied) {
              applied.encoding.applied = true;
              applied.encoding.details ??= res.details;
              data = res.data;
            }
          }

          if (sseFixer) {
            const res = sseFixer.fix(data);
            if (res.applied) {
              applied.sse.applied = true;
              applied.sse.details ??= res.details;
              data = res.data;
            }
          }

          if (jsonFixer) {
            const res = ResponseFixer.fixSseJsonLines(data, jsonFixer);
            if (res.applied) {
              applied.json.applied = true;
              applied.json.details ??= res.details;
              data = res.data;
            }
          }

          controller.enqueue(data);
        }

        audit.hit = applied.encoding.applied || applied.sse.applied || applied.json.applied;
        audit.processingTimeMs = Math.max(0, Math.round(nowMs() - startedAt));
        audit.fixersApplied = ResponseFixer.buildFixersApplied(applied, true);

        if (audit.hit) {
          session.addSpecialSetting(audit);
          persistSpecialSettings(session);
        }
      },
    });

    return new Response(response.body?.pipeThrough(transform), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  private static buildFixersApplied(
    applied: ResponseFixerApplied,
    includeSse: boolean
  ): ResponseFixerSpecialSetting["fixersApplied"] {
    const out: ResponseFixerSpecialSetting["fixersApplied"] = [];
    out.push({
      fixer: "encoding",
      applied: applied.encoding.applied,
      details: applied.encoding.details,
    });
    if (includeSse) {
      out.push({
        fixer: "sse",
        applied: applied.sse.applied,
        details: applied.sse.details,
      });
    }
    out.push({
      fixer: "json",
      applied: applied.json.applied,
      details: applied.json.details,
    });
    return out;
  }

  private static fixSseJsonLines(
    data: Uint8Array,
    jsonFixer: JsonFixer
  ): { data: Uint8Array; applied: boolean; details?: string } {
    // 仅处理 LF 分隔的行（SseFixer 输出已统一为 LF）
    let chunks: Uint8Array[] | null = null;
    let applied = false;
    let cursor = 0;

    let lineStart = 0;
    for (let i = 0; i < data.length; i += 1) {
      if (data[i] !== LF_BYTE) continue;

      const line = data.subarray(lineStart, i);
      const fixed = ResponseFixer.fixMaybeDataJsonLine(line, jsonFixer);

      if (!fixed.applied) {
        if (chunks) {
          chunks.push(data.subarray(cursor, i + 1));
          cursor = i + 1;
        }
        lineStart = i + 1;
        continue;
      }

      applied = true;
      chunks ??= [];
      if (cursor < lineStart) {
        chunks.push(data.subarray(cursor, lineStart));
      }
      chunks.push(fixed.line);
      chunks.push(LF_BYTES);
      cursor = i + 1;
      lineStart = i + 1;
    }

    // 处理末尾无换行的残留（理论上很少发生，但 flush 时可能出现）
    if (lineStart < data.length) {
      const line = data.subarray(lineStart);
      const fixed = ResponseFixer.fixMaybeDataJsonLine(line, jsonFixer);

      if (!fixed.applied) {
        if (chunks) {
          chunks.push(data.subarray(cursor));
        }
      } else {
        applied = true;
        chunks ??= [];
        if (cursor < lineStart) {
          chunks.push(data.subarray(cursor, lineStart));
        }
        chunks.push(fixed.line);
      }
    }

    if (!chunks) {
      return { data, applied: false };
    }

    return { data: concatUint8Chunks(chunks), applied };
  }

  private static fixMaybeDataJsonLine(
    line: Uint8Array,
    jsonFixer: JsonFixer
  ): { line: Uint8Array; applied: boolean } {
    if (line.length < SSE_DATA_PREFIX.length) return { line, applied: false };

    for (let i = 0; i < SSE_DATA_PREFIX.length; i += 1) {
      if (line[i] !== SSE_DATA_PREFIX[i]) {
        return { line, applied: false };
      }
    }

    let payloadStart = SSE_DATA_PREFIX.length;
    if (payloadStart < line.length && line[payloadStart] === 0x20 /* space */) {
      payloadStart += 1;
    }

    const payload = line.subarray(payloadStart);
    const res = jsonFixer.fix(payload);
    if (!res.applied) {
      return { line, applied: false };
    }

    const out = new Uint8Array(SSE_DATA_PREFIX_WITH_SPACE.length + res.data.length);
    out.set(SSE_DATA_PREFIX_WITH_SPACE, 0);
    out.set(res.data, SSE_DATA_PREFIX_WITH_SPACE.length);
    return { line: out, applied: true };
  }
}
