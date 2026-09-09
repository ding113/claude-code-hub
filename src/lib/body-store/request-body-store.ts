import { Readable } from "node:stream";
import { getHeapStatistics } from "node:v8";
import {
  createBrotliDecompress,
  createGunzip,
  createInflate,
  createInflateRaw,
  createZstdDecompress,
} from "node:zlib";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";
import {
  MAX_COMPRESSED_REQUEST_BYTES,
  MAX_CONTENT_ENCODING_LAYERS,
  MAX_DECOMPRESSED_REQUEST_BYTES,
  parseContentEncoding,
} from "@/app/v1/_lib/proxy/request-body-codec";
import { getMemoryGovernor, LocalCapacityError, type MemoryLease } from "@/lib/memory/governor";
import { attachRequestMemory } from "@/lib/memory/request-lifetime";
import { AllocationEstimate } from "./allocation-estimate";
import { ByteStore, STORE_SCRATCH_BYTES } from "./byte-store";

const supported = new Set(["gzip", "x-gzip", "br", "deflate", "zstd"]);
const allocations = new FinalizationRegistry<MemoryLease>((lease) => lease.release());

/** HTTP 租约随响应和后台消费者结束归还；独立调用方保留 GC 兜底。 */
export function retainRequestMemory(owner: object, lease: MemoryLease): void {
  if (!attachRequestMemory(lease)) allocations.register(owner, lease);
}

/** 入站流只有一个消费者；大正文可重读落盘，解压逐块校验输出上限。 */
export async function loadRequestBody(
  request: Request,
  decode = true
): Promise<{
  buffer: ArrayBuffer;
  originalByteLength: number;
  encoding: string | null;
  lease: MemoryLease;
}> {
  const governor = getMemoryGovernor();
  const started = performance.now();
  const remaining = () => Math.max(0, 20000 - (performance.now() - started));
  const encodings = decode ? parseContentEncoding(request.headers.get("content-encoding")) : [];
  const compressed = encodings.length === 1 && supported.has(encodings[0]);
  const rawLease = await governor.acquire(STORE_SCRATCH_BYTES, request.signal, remaining());
  let decodedLease: MemoryLease | null = null;
  let materializedLease: MemoryLease | null = null;
  const raw = new ByteStore(rawLease, { signal: request.signal });
  let decoded: ByteStore | null = null;
  let originalByteLength = 0;
  let estimate = new AllocationEstimate();
  try {
    // 在读入正文之前取得解压工作集，避免读入大正文后再等待基础容量。
    if (compressed)
      decodedLease = await governor.acquire(STORE_SCRATCH_BYTES, request.signal, remaining());
    const reader = request.body?.getReader();
    const readStarted = performance.now();
    if (reader) {
      const onAbort = () => {
        void reader.cancel(request.signal.reason).catch(() => undefined);
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
      try {
        while (true) {
          if (request.signal.aborted) throw request.signal.reason;
          const { done, value } = await reader.read();
          if (request.signal.aborted) throw request.signal.reason;
          if (done) break;
          originalByteLength += value.byteLength;
          if (encodings.length > MAX_CONTENT_ENCODING_LAYERS)
            throw new ProxyError(
              `Too many content-encoding layers (${encodings.length}); at most ${MAX_CONTENT_ENCODING_LAYERS} are allowed.`,
              400
            );
          if (compressed && originalByteLength > MAX_COMPRESSED_REQUEST_BYTES)
            throw new ProxyError(
              `Compressed request body exceeds the maximum allowed size (${MAX_COMPRESSED_REQUEST_BYTES} bytes).`,
              413
            );
          await raw.append(value);
          estimate.feed(value);
        }
      } catch (error) {
        void reader.cancel(error).catch(() => undefined);
        throw error;
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        reader.releaseLock();
      }
    }
    governor.observe("body_read", performance.now() - readStarted, originalByteLength);
    const decodeStarted = performance.now();
    let source = raw;
    let encoding: string | null = null;
    if (compressed && originalByteLength > 0 && decodedLease) {
      const run = async (rawDeflate: boolean) => {
        estimate = new AllocationEstimate();
        decoded = new ByteStore(decodedLease!, { signal: request.signal });
        const options = { chunkSize: 64 * 1024 };
        const decoder =
          encodings[0] === "zstd"
            ? createZstdDecompress(options)
            : encodings[0] === "br"
              ? createBrotliDecompress(options)
              : encodings[0] === "deflate"
                ? rawDeflate
                  ? createInflateRaw(options)
                  : createInflate(options)
                : createGunzip(options);
        const input = Readable.fromWeb(raw.stream() as import("node:stream/web").ReadableStream);
        const onAbort = () => decoder.destroy(new Error("Request aborted"));
        request.signal.addEventListener("abort", onAbort, { once: true });
        input.on("error", (error) => decoder.destroy(error));
        input.pipe(decoder);
        let size = 0;
        try {
          for await (const chunk of decoder) {
            if (request.signal.aborted) throw request.signal.reason;
            size += chunk.byteLength;
            if (size > MAX_DECOMPRESSED_REQUEST_BYTES)
              throw new ProxyError(
                `Request body exceeds the maximum decompressed size (${MAX_DECOMPRESSED_REQUEST_BYTES} bytes).`,
                413
              );
            await decoded.append(chunk);
            estimate.feed(chunk);
          }
        } finally {
          request.signal.removeEventListener("abort", onAbort);
          input.destroy();
          decoder.destroy();
        }
      };
      try {
        await run(false);
      } catch (error) {
        if (
          encodings[0] === "deflate" &&
          (error as NodeJS.ErrnoException)?.code === "Z_DATA_ERROR"
        ) {
          await (decoded as ByteStore | null)?.dispose();
          decodedLease.shrinkTo(STORE_SCRATCH_BYTES);
          try {
            await run(true);
          } catch (fallback) {
            if ((fallback as NodeJS.ErrnoException)?.code?.startsWith("Z_"))
              throw new ProxyError("Failed to decode 'deflate' request body", 400);
            throw fallback;
          }
        } else {
          if (
            /^(Z_|ZSTD_|ERR__ERROR_|ERR_BROTLI_|ERR_PADDING_)/.test(
              (error as NodeJS.ErrnoException)?.code ?? ""
            )
          )
            throw new ProxyError(`Failed to decode '${encodings[0]}' request body`, 400);
          throw error;
        }
      }
      source = decoded!;
      encoding = encodings[0];
      await raw.dispose(() => rawLease.release());
    }
    governor.observe("body_decode", performance.now() - decodeStarted, source.byteLength);
    const materializeStarted = performance.now();
    // 完整过滤、重写仍需要对象。其短期物化由独立租约约束，不给每个小请求预占 100 MiB。
    materializedLease = await governor.acquire(estimate.capacityBytes, request.signal, remaining());
    const heap = getHeapStatistics();
    if (estimate.capacityBytes > (heap.heap_size_limit - heap.used_heap_size) * 0.5) {
      throw new LocalCapacityError();
    }
    const buffer = await source.arrayBuffer();
    governor.observe("body_materialize", performance.now() - materializeStarted, source.byteLength);
    const lease = materializedLease;
    materializedLease = null;
    return { buffer, encoding, originalByteLength, lease };
  } finally {
    await Promise.allSettled([
      raw.dispose(() => rawLease.release()),
      (decoded as ByteStore | null)?.dispose(() => decodedLease?.release()),
    ]);
    if (!decoded) decodedLease?.release();
    materializedLease?.release();
  }
}
