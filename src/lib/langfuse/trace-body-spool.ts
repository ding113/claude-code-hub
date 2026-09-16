import { Readable, type Transform } from "node:stream";
import { constants, createZstdCompress, createZstdDecompress } from "node:zlib";
import { BufferedByteChunks } from "@/app/v1/_lib/proxy/buffered-byte-chunks";
import { STORE_SCRATCH_BYTES } from "@/lib/body-store/byte-store";
import { logger } from "@/lib/logger";
import { getMemoryGovernor, type MemoryLease } from "@/lib/memory/governor";

/** 低于该原始字节数不建压缩器，直接留原始块，小响应不必为 CCtx 付内存。 */
const RAW_HOT_BYTES = 1024 * 1024;
const BLOCK_BYTES = 64 * 1024;
const FLUSH_DELAY_MS = 100;
/** 实测 zstd level 3 + windowLog 20 的压缩上下文约 1.25MB，取整留余量。 */
const ZSTD_CCTX_BYTES = 1536 * 1024;
/** 只在累计写入这么多原始字节后才显式 flush，避免按事件切块损失压缩率。 */
const FLUSH_INTERVAL_BYTES = 4 * 1024 * 1024;

/** zlib 流才有 flush；测试可注入普通 Transform，因此按可选成员处理。 */
type CompressorStream = Transform & {
  flush?: (kind: number, callback: () => void) => void;
};

export interface LangfuseTraceBodySource {
  /** 失败返回 null，调用方回退到有界快照文本。 */
  materialize(): Promise<string | null>;
  /** 幂等，重复调用共享同一个 promise。 */
  dispose(): Promise<void>;
}

export interface LangfuseTraceBodySpoolOptions {
  hotBytes?: number;
  blockBytes?: number;
  flushDelayMs?: number;
  compressorFactory?: () => CompressorStream;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createDefaultCompressor(): CompressorStream {
  return createZstdCompress({
    params: {
      [constants.ZSTD_c_compressionLevel]: 3,
      [constants.ZSTD_c_windowLog]: 20,
    },
  });
}

/**
 * 为单个响应聚合完整正文，供 Langfuse trace 使用。
 *
 * 全程共用一个 zstd 压缩上下文：写入走隐式 ZSTD_e_continue，只有跨越
 * FLUSH_INTERVAL_BYTES 才显式 ZSTD_e_flush，ZSTD_e_end 仅在 materialize 出现一次，
 * 因此整个响应是单个 zstd frame，而不是一事件一 frame。
 */
export class LangfuseTraceBodySpool implements LangfuseTraceBodySource {
  private readonly hotBytes: number;
  private readonly blockBytes: number;
  private readonly flushDelayMs: number;
  private readonly compressorFactory: () => CompressorStream;

  private pending: BufferedByteChunks;
  private compressed: BufferedByteChunks;
  private compressor: CompressorStream | null = null;

  private pendingBytes = 0;
  private compressedBytes = 0;
  private inflightRawBytes = 0;
  private rawBytes = 0;
  private bytesSinceFlush = 0;

  private failed = false;
  private ended = false;
  private disposePromise: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly lease: MemoryLease,
    options: LangfuseTraceBodySpoolOptions = {}
  ) {
    this.hotBytes = options.hotBytes ?? RAW_HOT_BYTES;
    this.blockBytes = options.blockBytes ?? BLOCK_BYTES;
    this.flushDelayMs = options.flushDelayMs ?? FLUSH_DELAY_MS;
    this.compressorFactory = options.compressorFactory ?? createDefaultCompressor;
    this.pending = new BufferedByteChunks(this.blockBytes, this.blockBytes);
    this.compressed = new BufferedByteChunks(this.blockBytes, this.blockBytes);
  }

  /** 热路径：同步、不抛异常、失败后彻底停止观察。 */
  observe(chunk: Uint8Array): void {
    if (this.failed || this.ended || this.disposePromise) return;
    if (!chunk || chunk.byteLength === 0) return;

    try {
      // BufferedByteChunks.append 已复制，调用方缓冲区不会被长期引用。
      this.pending.append(chunk);
      this.pendingBytes += chunk.byteLength;
      this.rawBytes += chunk.byteLength;

      if (!this.grow()) {
        this.fail("memory_lease_exhausted");
        return;
      }

      if (!this.compressor) {
        if (this.rawBytes <= this.hotBytes) return;
        if (!this.startCompressor()) return;
      }

      if (this.pendingBytes >= this.blockBytes) {
        this.drainPending();
        return;
      }
      this.armTimer();
    } catch (error) {
      this.fail("observe_failed", error);
    }
  }

  async materialize(): Promise<string | null> {
    if (this.failed || this.disposePromise) return null;
    this.ended = true;
    this.clearTimer();

    try {
      if (!this.compressor) {
        return this.decodeBlocks(this.pending.views());
      }

      this.drainPending();
      await this.writeChain;
      if (this.failed) return null;

      await this.endCompressor();
      if (this.failed) return null;

      if (!this.lease.tryGrow(this.currentReservation() + this.rawBytes)) {
        this.fail("memory_lease_exhausted");
        return null;
      }

      const text = await this.decodeCompressed();
      this.compressed.clear();
      this.compressedBytes = 0;
      return text;
    } catch (error) {
      this.fail("materialize_failed", error);
      return null;
    }
  }

  dispose(): Promise<void> {
    if (!this.disposePromise) {
      this.disposePromise = (async () => {
        this.clearTimer();
        try {
          await this.writeChain;
        } catch {
          // 写链错误已在 fail 中处理
        }
        this.compressor?.destroy();
        this.compressor = null;
        this.pending.clear();
        this.compressed.clear();
        this.pendingBytes = 0;
        this.compressedBytes = 0;
        this.inflightRawBytes = 0;
        this.lease.release();
      })();
    }
    return this.disposePromise;
  }

  private currentReservation(): number {
    return (
      STORE_SCRATCH_BYTES +
      (this.compressor ? ZSTD_CCTX_BYTES : 0) +
      this.pendingBytes +
      this.compressedBytes +
      this.inflightRawBytes
    );
  }

  private grow(): boolean {
    return this.lease.tryGrow(this.currentReservation());
  }

  private startCompressor(): boolean {
    if (!this.lease.tryGrow(this.currentReservation() + ZSTD_CCTX_BYTES)) {
      this.fail("memory_lease_exhausted");
      return false;
    }

    try {
      const compressor = this.compressorFactory();
      compressor.on("data", (block: Buffer) => {
        if (this.disposePromise) return;
        this.compressed.append(block);
        this.compressedBytes += block.byteLength;
        if (!this.grow()) this.fail("memory_lease_exhausted");
      });
      compressor.on("error", (error: unknown) => this.fail("compressor_error", error));
      this.compressor = compressor;
      return true;
    } catch (error) {
      this.fail("compressor_create_failed", error);
      return false;
    }
  }

  private armTimer(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drainPending();
    }, this.flushDelayMs);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 聚合写入：整块交给压缩器，绝不按单个 SSE 事件调用。 */
  private drainPending(): void {
    this.clearTimer();
    if (!this.compressor || this.pendingBytes === 0 || this.failed) return;

    const blocks = this.pending.take();
    const bytes = this.pendingBytes;
    this.pendingBytes = 0;
    this.inflightRawBytes += bytes;
    this.bytesSinceFlush += bytes;

    const needsFlush = this.bytesSinceFlush >= FLUSH_INTERVAL_BYTES;
    if (needsFlush) this.bytesSinceFlush = 0;

    this.writeChain = this.writeChain
      .then(() => this.writeBlocks(blocks, bytes, needsFlush))
      .catch((error) => {
        this.fail("compressor_write_failed", error);
      });
  }

  private writeBlocks(blocks: Uint8Array[], bytes: number, needsFlush: boolean): Promise<void> {
    return new Promise<void>((resolve) => {
      const compressor = this.compressor;
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        this.inflightRawBytes -= bytes;
        resolve();
      };

      if (!compressor || this.failed || this.disposePromise) {
        settle();
        return;
      }

      let index = 0;
      const next = (): void => {
        if (this.failed || this.disposePromise) {
          settle();
          return;
        }
        if (index >= blocks.length) {
          if (needsFlush && typeof compressor.flush === "function") {
            // ZSTD_e_flush 只切块不结束 frame，整个响应仍是单个 frame。
            compressor.flush(constants.ZSTD_e_flush, () => settle());
            return;
          }
          settle();
          return;
        }
        const block = blocks[index++];
        compressor.write(block, (error) => {
          if (error) {
            this.fail("compressor_write_failed", error);
            settle();
            return;
          }
          next();
        });
      };
      next();
    });
  }

  private endCompressor(): Promise<void> {
    return new Promise<void>((resolve) => {
      const compressor = this.compressor;
      if (!compressor) {
        resolve();
        return;
      }
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      compressor.once("end", settle);
      compressor.once("error", settle);
      compressor.once("close", settle);
      compressor.end();
    });
  }

  private async decodeCompressed(): Promise<string> {
    const source = Readable.from(this.compressed.views(), { objectMode: false });
    const decompressor = createZstdDecompress();
    const decoder = new TextDecoder();
    let text = "";

    source.pipe(decompressor);
    for await (const block of decompressor) {
      text += decoder.decode(block as Uint8Array, { stream: true });
    }
    text += decoder.decode();
    return text;
  }

  private decodeBlocks(blocks: Uint8Array[]): string {
    const decoder = new TextDecoder();
    let text = "";
    for (const block of blocks) {
      text += decoder.decode(block, { stream: true });
    }
    text += decoder.decode();
    return text;
  }

  private fail(reason: string, error?: unknown): void {
    if (this.failed) return;
    this.failed = true;
    logger.warn("[Langfuse] Trace body spool disabled", {
      reason,
      ...(error !== undefined ? { error: describeError(error) } : {}),
    });
    try {
      this.compressor?.destroy();
    } catch {
      // destroy 失败不影响降级
    }
    this.compressor = null;
    this.pending.clear();
    this.compressed.clear();
    this.pendingBytes = 0;
    this.compressedBytes = 0;
    this.inflightRawBytes = 0;
    this.lease.shrinkTo(STORE_SCRATCH_BYTES);
  }
}

/**
 * 无 Langfuse key 或拿不到内存租约时返回 null，调用方继续使用有界快照文本。
 */
export function tryCreateLangfuseTraceBodySpool(
  options: LangfuseTraceBodySpoolOptions = {}
): LangfuseTraceBodySpool | null {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return null;

  const lease = getMemoryGovernor().tryLease(STORE_SCRATCH_BYTES);
  if (!lease) return null;

  try {
    return new LangfuseTraceBodySpool(lease, options);
  } catch (error) {
    lease.release();
    logger.warn("[Langfuse] Trace body spool creation failed", {
      error: describeError(error),
    });
    return null;
  }
}
