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

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b.slice();
  if (b.length === 0) return a.slice();
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function findProcessableEnd(buffer: Uint8Array): number {
  // 从尾部向前找换行符，保证不在 CRLF 中间切分
  for (let i = buffer.length - 1; i >= 0; i -= 1) {
    const b = buffer[i];
    if (b === 0x0a /* LF */) return i + 1;
    if (b === 0x0d /* CR */) {
      if (i === buffer.length - 1) return 0; // 末尾 CR，等待下一块是否为 CRLF
      if (buffer[i + 1] === 0x0a) return i + 2;
      return i + 1;
    }
  }
  return 0;
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
    headers.set("x-cch-response-fixer", "applied");

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

    let buffer: Uint8Array = new Uint8Array(0);

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        audit.totalBytesProcessed += chunk.length;
        buffer = concatBytes(buffer, chunk);

        const end = findProcessableEnd(buffer);
        if (end <= 0) {
          return;
        }

        const toProcess = buffer.slice(0, end);
        buffer = buffer.slice(end);

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
          let data: Uint8Array = buffer;
          buffer = new Uint8Array(0);

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

    const headers = cleanResponseHeaders(response.headers);
    headers.set("x-cch-response-fixer", "applied");

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
    const out: number[] = [];
    let applied = false;

    let lineStart = 0;
    for (let i = 0; i < data.length; i += 1) {
      if (data[i] !== 0x0a /* LF */) continue;

      const line = data.subarray(lineStart, i);
      const fixed = ResponseFixer.fixMaybeDataJsonLine(line, jsonFixer);
      if (fixed.applied) applied = true;
      out.push(...fixed.line, 0x0a);

      lineStart = i + 1;
    }

    // 处理末尾无换行的残留（理论上很少发生，但 flush 时可能出现）
    if (lineStart < data.length) {
      const line = data.subarray(lineStart);
      const fixed = ResponseFixer.fixMaybeDataJsonLine(line, jsonFixer);
      if (fixed.applied) applied = true;
      out.push(...fixed.line);
    }

    return { data: Uint8Array.from(out), applied };
  }

  private static fixMaybeDataJsonLine(
    line: Uint8Array,
    jsonFixer: JsonFixer
  ): { line: Uint8Array; applied: boolean } {
    const dataPrefix = [0x64, 0x61, 0x74, 0x61, 0x3a]; // data:

    if (line.length < dataPrefix.length) return { line, applied: false };

    for (let i = 0; i < dataPrefix.length; i += 1) {
      if (line[i] !== dataPrefix[i]) {
        return { line, applied: false };
      }
    }

    let payloadStart = dataPrefix.length;
    if (payloadStart < line.length && line[payloadStart] === 0x20 /* space */) {
      payloadStart += 1;
    }

    const payload = line.subarray(payloadStart);
    const res = jsonFixer.fix(payload);
    if (!res.applied) {
      return { line, applied: false };
    }

    const out = new Uint8Array(6 + res.data.length);
    out.set([0x64, 0x61, 0x74, 0x61, 0x3a, 0x20], 0); // data:␠
    out.set(res.data, 6);
    return { line: out, applied: true };
  }
}
