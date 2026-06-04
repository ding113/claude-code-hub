/**
 * 入站请求体解压（content-encoding）。
 *
 * 背景：Codex 等客户端会用 `content-encoding: zstd`（也可能是 gzip/deflate/br）
 * 压缩请求体后发往代理。代理需要解压才能解析出 model、做敏感词/过滤、计费与日志。
 * 解压后由上层剥离 `content-encoding` 头，并以明文转发给上游（content-length 会被
 * 出站黑名单重算）。
 *
 * 运行时为 Node.js（route.ts: `runtime = "nodejs"`）。`node:zlib` 自 Node 22.15 起
 * 原生提供 zstd 同步解压（gzip/deflate/br 更早即有），无需第三方依赖。该最低版本要求
 * 由 package.json 的 `engines` 字段声明；生产镜像（deploy/Dockerfile 的 node:trixie-slim）
 * 运行 Node 24+，满足要求。
 *
 * 注意：解压在 `ProxySession.fromContext` 内、鉴权 guard 之前同步执行（与既有的请求体
 * `JSON.parse` 一致）。单层编码 + maxOutputBytes 输出上限将其最坏开销限定为单次有界解压。
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

/** 解析「字节数」环境变量；非法/缺省时回退到 fallback。 */
function parseByteLimitEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

/**
 * 解压输出硬上限，防御解压炸弹（decompression bomb）：很小的压缩体可能展开成数 GB
 * 导致 OOM。这是一个独立的内存兜底阈值——注意 /v1、/v1beta 代理路径并不受
 * next.config.ts 的 proxyClientMaxBodySize 钳制（见 proxy.matcher.ts），故入站压缩体
 * 体积本身不另设限。逐层解压按此上限增量限制，超过即按 413 拒绝。
 *
 * 默认 100MB（代理刻意支持大请求体，见 next.config.ts proxyClientMaxBodySize）。
 * 可经环境变量 MAX_DECOMPRESSED_REQUEST_BYTES 覆盖（字节数），供内存受限部署下调上限。
 */
export const MAX_DECOMPRESSED_REQUEST_BYTES = parseByteLimitEnv(
  "MAX_DECOMPRESSED_REQUEST_BYTES",
  100 * 1024 * 1024
);

/**
 * 压缩输入（线上字节）硬上限。解压在 `ProxySession.fromContext` 内、鉴权 guard 之前同步执行，
 * 且 /v1、/v1beta 路径不受 proxyClientMaxBodySize 钳制（见上）。该上限在解压前先按压缩体本身
 * 的字节数拒绝过大输入，作为鉴权前的结构性天花板（限制需读取+解压的输入量）。
 *
 * 默认与 {@link MAX_DECOMPRESSED_REQUEST_BYTES} 一致：真实压缩比下合法请求的压缩体一定不超过其
 * 解压体，故该默认不会误拒既有的大上下文/图片压缩请求（避免「明文 100MB 放行、压缩体却被拒」的
 * 不对称）。内存受限部署下调 MAX_DECOMPRESSED_REQUEST_BYTES 时本上限随之收紧；也可经
 * MAX_COMPRESSED_REQUEST_BYTES 单独覆盖。超过按 413 拒绝。
 */
export const MAX_COMPRESSED_REQUEST_BYTES = parseByteLimitEnv(
  "MAX_COMPRESSED_REQUEST_BYTES",
  MAX_DECOMPRESSED_REQUEST_BYTES
);

/**
 * content-encoding 编码链最大层数。真实客户端（含 Codex）只发单层编码；允许多层会让一个
 * 很小的压缩体经多次同步解压放大 CPU 开销与峰值内存（每层最多解到 maxOutputBytes，层间
 * 缓冲还会短暂共存），无正当用途。限制为单层后，峰值解压内存即由 maxOutputBytes 一档兜底；
 * 超出按 400 拒绝。
 */
export const MAX_CONTENT_ENCODING_LAYERS = 1;

const SUPPORTED_ENCODINGS = new Set(["zstd", "gzip", "x-gzip", "deflate", "br"]);

export interface DecodeRequestBodyOptions {
  /** 解压输出字节上限，默认 {@link MAX_DECOMPRESSED_REQUEST_BYTES}。主要用于测试。 */
  maxOutputBytes?: number;
  /** 压缩输入字节上限，默认 {@link MAX_COMPRESSED_REQUEST_BYTES}。主要用于测试。 */
  maxCompressedBytes?: number;
}

export interface DecodedRequestBody {
  /**
   * 请求体明文字节。解压时为新分配的解压结果；未解压时即原始字节，可能与入参共享
   * 底层内存（仅供只读消费，调用方不得改写）。
   */
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

// 返回的 buffer 仅被下游只读消费（TextDecoder / JSON.parse / 透传转发），不会被改写，
// 故视图正好完整覆盖底层 ArrayBuffer 时直接复用、避免对最大 100MB 数据做无谓拷贝。
function toArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  if (input.byteOffset === 0 && input.byteLength === input.buffer.byteLength) {
    return input.buffer as ArrayBuffer;
  }
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) {
    return buf.buffer as ArrayBuffer;
  }
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
  const maxCompressedBytes = options?.maxCompressedBytes ?? MAX_COMPRESSED_REQUEST_BYTES;
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

  // 空体：不可能是有效压缩流，在层数/支持集校验之前直接透传，避免对安全的空请求误报 400。
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

  // 解压前先按压缩体本身字节数拒绝过大输入（鉴权前防放大，见 MAX_COMPRESSED_REQUEST_BYTES）。
  // 仅对「支持的单层编码」生效：上面已确保 encodings 非空、层数合法且全部受支持。
  if (originalByteLength > maxCompressedBytes) {
    throw new ProxyError(
      `Compressed request body exceeds the maximum allowed size (${maxCompressedBytes} bytes).`,
      413
    );
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
