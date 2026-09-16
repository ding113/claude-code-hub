import { promisify } from "node:util";
import { constants, zstdCompress, zstdDecompress } from "node:zlib";
import { logger } from "@/lib/logger";

const compressAsync = promisify(zstdCompress);
const decompressAsync = promisify(zstdDecompress);

/** 小于该阈值的载荷压缩收益抵不上编码开销，直接原样保留。 */
export const COMPRESS_MIN_BYTES = 16 * 1024;

/**
 * 信封前缀使用 US(0x1f) 控制符：JSON.stringify 输出不可能包含它，真实 SSE 正文也不会以它开头，
 * 因此前缀判定不存在歧义，旧版本写入的明文可以原样读回。
 */
export const PAYLOAD_ENVELOPE_PREFIX = `${String.fromCharCode(0x1f)}zst1:`;

const ZSTD_PARAMS: Record<number, number> = {
  [constants.ZSTD_c_compressionLevel]: 3,
  [constants.ZSTD_c_windowLog]: 20,
};

let compressFailureLogged = false;
let decompressFailureLogged = false;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isCompressedPayload(value: string): boolean {
  return typeof value === "string" && value.startsWith(PAYLOAD_ENVELOPE_PREFIX);
}

/**
 * 压缩后以 base64 信封返回。始终走 zlib 异步 API（libuv 线程池），不阻塞事件循环。
 * 失败只记一次日志并返回原文，降级为当前行为而不是丢掉产物。
 */
export async function compressPayload(text: string): Promise<string> {
  if (typeof text !== "string" || text.length === 0) return text;
  if (Buffer.byteLength(text, "utf8") < COMPRESS_MIN_BYTES) return text;

  try {
    const encoded = await compressAsync(Buffer.from(text, "utf8"), { params: ZSTD_PARAMS });
    return `${PAYLOAD_ENVELOPE_PREFIX}${encoded.toString("base64")}`;
  } catch (error) {
    if (!compressFailureLogged) {
      compressFailureLogged = true;
      logger.warn("[Compression] Payload compression failed, storing raw", {
        error: describeError(error),
      });
    }
    return text;
  }
}

/** 非信封值原样返回，保证旧数据与低于阈值的数据无需迁移即可读回。 */
export async function decompressPayload(value: string): Promise<string> {
  if (!isCompressedPayload(value)) return value;

  try {
    const decoded = await decompressAsync(
      Buffer.from(value.slice(PAYLOAD_ENVELOPE_PREFIX.length), "base64")
    );
    return decoded.toString("utf8");
  } catch (error) {
    if (!decompressFailureLogged) {
      decompressFailureLogged = true;
      logger.warn("[Compression] Payload decompression failed", {
        error: describeError(error),
      });
    }
    return value;
  }
}

/** 仅供测试复位一次性告警标记。 */
export function resetPayloadCodecWarnings(): void {
  compressFailureLogged = false;
  decompressFailureLogged = false;
}
