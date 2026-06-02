/**
 * 入站请求体解压（content-encoding）。
 *
 * 背景：Codex 等客户端会用 `content-encoding: zstd`（也可能是 gzip/deflate/br）
 * 压缩请求体后发往代理。代理需要解压才能解析出 model、做敏感词/过滤、计费与日志。
 * 解压后由上层剥离 `content-encoding` 头，并以明文转发给上游（content-length 会被
 * 出站黑名单重算）。
 *
 * 运行时为 Node.js（route.ts: `runtime = "nodejs"`），Node 24 的 `node:zlib`
 * 原生提供 zstd/gzip/deflate/br 同步解压，无需第三方依赖。
 */
import {
  brotliDecompressSync,
  gunzipSync,
  inflateRawSync,
  inflateSync,
  zstdDecompressSync,
} from "node:zlib";
import { logger } from "@/lib/logger";
import { ProxyError } from "./errors";

/**
 * 解压输出硬上限，防御解压炸弹（decompression bomb）：很小的压缩体可能展开成数 GB
 * 导致 OOM。这是一个独立的内存兜底阈值——注意 /v1、/v1beta 代理路径并不受
 * next.config.ts 的 proxyClientMaxBodySize 钳制（见 proxy.matcher.ts），故入站压缩体
 * 体积本身不另设限。逐层解压按此上限增量限制，超过即按 413 拒绝。
 */
export const MAX_DECOMPRESSED_REQUEST_BYTES = 100 * 1024 * 1024;

/**
 * content-encoding 编码链最大层数。真实客户端最多 1-2 层；层数过多只会放大同步解压的
 * CPU 开销（每层一次同步解压），无正当用途，直接按 400 拒绝以消除该放大面。
 */
export const MAX_CONTENT_ENCODING_LAYERS = 3;

const SUPPORTED_ENCODINGS = new Set(["zstd", "gzip", "x-gzip", "deflate", "br"]);

export interface DecodeRequestBodyOptions {
  /** 解压输出字节上限，默认 {@link MAX_DECOMPRESSED_REQUEST_BYTES}。主要用于测试。 */
  maxOutputBytes?: number;
}

export interface DecodedRequestBody {
  /** 解压后的请求体；未解压时即原始字节（拷贝为独立 ArrayBuffer）。 */
  buffer: ArrayBuffer;
  /** 是否实际执行了解压。 */
  decoded: boolean;
  /** 实际应用的编码链（按解码顺序，如 "zstd" 或 "br, gzip"）；未解压时为 null。 */
  encoding: string | null;
  originalByteLength: number;
  decodedByteLength: number;
}

/**
 * 将 `content-encoding` 头解析为编码 token 列表（小写、去空白、去除 identity）。
 * HTTP 语义为「按列出顺序逐层应用」，因此解码需反向进行。
 */
export function parseContentEncoding(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0 && token !== "identity");
}

function isOutputTooLargeError(err: unknown): boolean {
  return (
    err instanceof RangeError ||
    (err as NodeJS.ErrnoException | undefined)?.code === "ERR_BUFFER_TOO_LARGE"
  );
}

function decodeOne(buffer: Buffer, encoding: string, maxOutputLength: number): Buffer {
  switch (encoding) {
    case "zstd":
      return zstdDecompressSync(buffer, { maxOutputLength });
    case "gzip":
    case "x-gzip":
      return gunzipSync(buffer, { maxOutputLength });
    case "br":
      return brotliDecompressSync(buffer, { maxOutputLength });
    case "deflate":
      // HTTP `deflate` 名义上是 zlib 包装，但不少实现发送的是裸 deflate 流，
      // 因此先按 zlib 解，失败再回退裸 deflate。解压炸弹错误不回退，直接抛出。
      try {
        return inflateSync(buffer, { maxOutputLength });
      } catch (err) {
        if (isOutputTooLargeError(err)) throw err;
        return inflateRawSync(buffer, { maxOutputLength });
      }
    default:
      // parseContentEncoding + 支持集校验已保证不会走到这里。
      throw new Error(`Unsupported content-encoding: ${encoding}`);
  }
}

function toArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * 按 `content-encoding` 解压入站请求体。
 *
 * - 无编码 / identity / 空体：原样返回（decoded=false）。
 * - 含不支持的编码：不解压、原样返回（decoded=false）并告警，由上层透传给上游。
 * - 支持的编码：逐层反向解压；超过上限抛 413，损坏流抛 400。
 */
export function decodeRequestBody(
  input: ArrayBuffer | Uint8Array,
  contentEncoding: string | null | undefined,
  options?: DecodeRequestBodyOptions
): DecodedRequestBody {
  const maxOutputBytes = options?.maxOutputBytes ?? MAX_DECOMPRESSED_REQUEST_BYTES;
  const originalByteLength = input.byteLength;

  const encodings = parseContentEncoding(contentEncoding);
  if (encodings.length === 0) {
    const buffer = toArrayBuffer(input);
    return {
      buffer,
      decoded: false,
      encoding: null,
      originalByteLength,
      decodedByteLength: buffer.byteLength,
    };
  }

  if (encodings.length > MAX_CONTENT_ENCODING_LAYERS) {
    // 防御多层编码放大：每层都是一次同步解压，过多层数纯属攻击/异常。
    throw new ProxyError(
      `Too many content-encoding layers (${encodings.length}); at most ${MAX_CONTENT_ENCODING_LAYERS} are allowed.`,
      400
    );
  }

  const unsupported = encodings.filter((enc) => !SUPPORTED_ENCODINGS.has(enc));
  if (unsupported.length > 0) {
    // 透传：不解压、保留原始字节与 content-encoding 头，交给上游处理。
    logger.warn("[decodeRequestBody] Unsupported content-encoding, passing through untouched", {
      contentEncoding,
      unsupported,
    });
    const buffer = toArrayBuffer(input);
    return {
      buffer,
      decoded: false,
      encoding: null,
      originalByteLength,
      decodedByteLength: buffer.byteLength,
    };
  }

  // 空体：无需解压（也避免对部分解码器喂空流报错）。
  if (originalByteLength === 0) {
    const buffer = toArrayBuffer(input);
    return {
      buffer,
      decoded: false,
      encoding: null,
      originalByteLength,
      decodedByteLength: buffer.byteLength,
    };
  }

  // 按 HTTP 语义反向逐层解码。
  const decodeOrder = [...encodings].reverse();
  let current: Buffer = Buffer.from(input instanceof Uint8Array ? input : new Uint8Array(input));
  for (const enc of decodeOrder) {
    try {
      current = decodeOne(current, enc, maxOutputBytes);
    } catch (err) {
      if (isOutputTooLargeError(err)) {
        throw new ProxyError(
          `Request body exceeds the maximum decompressed size (${maxOutputBytes} bytes).`,
          413
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new ProxyError(`Failed to decode '${enc}' request body: ${message}`, 400);
    }
  }

  const buffer = bufferToArrayBuffer(current);
  logger.debug("[decodeRequestBody] Decompressed request body", {
    encoding: decodeOrder.join(", "),
    originalByteLength,
    decodedByteLength: buffer.byteLength,
  });

  return {
    buffer,
    decoded: true,
    encoding: decodeOrder.join(", "),
    originalByteLength,
    decodedByteLength: buffer.byteLength,
  };
}
