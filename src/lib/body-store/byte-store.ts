import { type FileHandle, mkdir, mkdtemp, open, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { BufferedByteChunks } from "@/app/v1/_lib/proxy/buffered-byte-chunks";
import { logger } from "@/lib/logger";
import { LocalCapacityError, type MemoryLease } from "@/lib/memory/governor";
import { getSpoolBudget, getSpoolRoot, spoolPrefix } from "../../../server-lib/spool-directory";

export const STORE_SCRATCH_BYTES = 128 * 1024;
const BLOCK_BYTES = 64 * 1024;
const HOT_BYTES = 256 * 1024;
const diskBudget = getSpoolBudget();
const warnedSpoolRoots = new Set<string>();

/** 单一字节所有者。每次写入等待落盘完成，异步写队列不会积累正文副本。 */
export class ByteStore {
  private memory = new BufferedByteChunks(BLOCK_BYTES, BLOCK_BYTES);
  private file: FileHandle | null = null;
  private directory: string | null = null;
  private diskLimit = 0;
  private diskBytes = 0;
  private cursor = 0;
  private disposed = false;
  private pending = new Set<Promise<unknown>>();
  private interrupted = false;
  private cleanup: Promise<void> | null = null;
  private cleanupRetry: ReturnType<typeof setTimeout> | null = null;
  private scratchBytes = STORE_SCRATCH_BYTES;
  byteLength = 0;

  constructor(
    private readonly lease: Pick<MemoryLease, "tryGrow" | "shrinkTo">,
    private readonly options: {
      directory?: string;
      hotBytes?: number;
      maxDiskBytes?: number;
      signal?: AbortSignal;
      ioTimeoutMs?: number;
    } = {}
  ) {}

  get spilled(): boolean {
    return this.file !== null;
  }
  get retainedByteLength(): number {
    return this.memory.retainedByteLength;
  }

  growScratchBy(bytes: number): boolean {
    if (!this.lease.tryGrow(this.scratchBytes + bytes + this.memory.retainedByteLength))
      return false;
    this.scratchBytes += bytes;
    return true;
  }

  async reserveScratch(bytes: number): Promise<void> {
    return this.operation(() => this.reserveScratchInternal(bytes));
  }

  private async reserveScratchInternal(bytes: number): Promise<void> {
    const target = Math.max(STORE_SCRATCH_BYTES, bytes);
    if (!this.lease.tryGrow(target + this.memory.retainedByteLength)) {
      if (!this.file) await this.spill();
      if (!this.lease.tryGrow(target)) throw new LocalCapacityError();
    }
    this.scratchBytes = target;
  }

  async append(chunk: Uint8Array): Promise<void> {
    return this.operation(() => this.appendInternal(chunk));
  }

  private async appendInternal(chunk: Uint8Array): Promise<void> {
    if (this.disposed) throw new Error("Body store disposed");
    const capacity = Math.ceil((this.byteLength + chunk.byteLength) / BLOCK_BYTES) * BLOCK_BYTES;
    if (
      !this.file &&
      capacity <= (this.options.hotBytes ?? HOT_BYTES) &&
      this.lease.tryGrow(this.scratchBytes + capacity)
    ) {
      this.memory.append(chunk);
      this.byteLength += chunk.byteLength;
      return;
    }
    if (!this.file) await this.spill();
    await this.write(chunk);
    this.byteLength += chunk.byteLength;
  }

  takeChunks(): Uint8Array[] {
    return this.memory.take();
  }

  async readPrefix(): Promise<Uint8Array | null> {
    if (!this.file || this.cursor >= this.byteLength) return null;
    const chunk = await this.readAt(this.cursor);
    this.cursor += chunk.byteLength;
    return chunk;
  }

  stream(): ReadableStream<Uint8Array> {
    let position = 0;
    const chunks = this.file ? [] : this.memoryChunks();
    let index = 0;
    return new ReadableStream(
      {
        pull: async (controller) => {
          if (position >= this.byteLength) {
            controller.close();
            return;
          }
          const chunk = this.file ? await this.readAt(position) : chunks[index++];
          position += chunk.byteLength;
          controller.enqueue(chunk);
        },
      },
      { highWaterMark: 0 }
    );
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const result = new Uint8Array(this.byteLength);
    const reader = this.stream().getReader();
    let offset = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result.set(value, offset);
        offset += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    return result.buffer;
  }

  /** 只由所有者调用；等待在途文件操作后清理，避免提前归还仍在使用的工作集。 */
  dispose(onSettled?: () => void): Promise<void> {
    if (!this.cleanup) {
      this.disposed = true;
      this.cleanup = (async () => {
        await Promise.allSettled([...this.pending]);
        this.memory.clear();
        await this.file?.close();
        this.file = null;
        if (this.directory) {
          await rm(this.directory, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 100,
          });
          this.directory = null;
          diskBudget.files--;
        }
        diskBudget.bytes -= this.diskBytes;
        this.diskBytes = 0;
        if (this.cleanupRetry) clearTimeout(this.cleanupRetry);
        this.cleanupRetry = null;
      })().catch((error) => {
        this.cleanup = null;
        // 删除未确认前仍保留磁盘额度；每个 store 最多一个后台重试。
        if (!this.cleanupRetry) {
          this.cleanupRetry = setTimeout(() => {
            this.cleanupRetry = null;
            void this.dispose().catch(() => undefined);
          }, 1000);
          this.cleanupRetry.unref?.();
        }
        throw error;
      });
    }
    // 超时只结束请求等待；内核 I/O 真正结束前仍保留租约，不能提前超卖内存。
    const cleanup = this.cleanup.finally(onSettled);
    if (this.interrupted) {
      void cleanup.catch(() => undefined);
      return Promise.resolve();
    }
    return this.bounded(cleanup, false);
  }

  private checkActive(): void {
    if (this.disposed || this.interrupted) throw new LocalCapacityError();
    if (this.options.signal?.aborted)
      throw this.options.signal.reason || new DOMException("Aborted", "AbortError");
  }

  private operation<T>(run: () => Promise<T>): Promise<T> {
    this.checkActive();
    const task = Promise.resolve().then(() => {
      this.checkActive();
      return run();
    });
    this.pending.add(task);
    void task.then(
      () => this.pending.delete(task),
      () => this.pending.delete(task)
    );
    return this.bounded(task, true);
  }

  private async bounded<T>(task: Promise<T>, abortable: boolean): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const signal = abortable ? this.options.signal : undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              this.interrupted = true;
              reject(new LocalCapacityError());
            },
            Math.min(20000, this.options.ioTimeoutMs ?? 20000)
          );
          onAbort = () => {
            this.interrupted = true;
            reject(signal?.reason || new DOMException("Aborted", "AbortError"));
          };
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) onAbort();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  }

  private memoryChunks(): Uint8Array[] {
    // 临时转移后立即归还同一组自有块，不创建无背压的 Request.tee 分支。
    return this.memory.views();
  }

  private async readAt(position: number): Promise<Uint8Array> {
    return this.operation(() => this.readAtInternal(position));
  }

  private async readAtInternal(position: number): Promise<Uint8Array> {
    if (!this.file || this.disposed) throw new Error("Body store disposed");
    const chunk = new Uint8Array(Math.min(BLOCK_BYTES, this.byteLength - position));
    const operation = this.file.read(chunk, 0, chunk.byteLength, position);
    const { bytesRead } = await operation;
    if (bytesRead === 0) throw new Error("Unexpected EOF in body store");
    return chunk.subarray(0, bytesRead);
  }

  private async spill(): Promise<void> {
    if (diskBudget.files >= 256) throw new LocalCapacityError();
    diskBudget.files++;
    try {
      const root = path.resolve(/*turbopackIgnore: true*/ this.options.directory ?? getSpoolRoot());
      await mkdir(root, { recursive: true, mode: 0o700 });
      this.checkActive();
      const stats = await statfs(root);
      this.checkActive();
      // tmpfs / ramfs 仍占用同一物理内存，不能充当溢写层。
      if (stats.type === 0x01021994 || stats.type === 0x858458f6) {
        if (!warnedSpoolRoots.has(root)) {
          warnedSpoolRoots.add(root);
          logger.warn("memory_spool_unavailable", {
            root,
            reason: "tmpfs_or_ramfs",
            action: "Set CCH_MEMORY_SPILL_DIR to a real disk directory",
          });
        }
        throw new LocalCapacityError();
      }
      const workers = Math.max(1, Number(process.env.CCH_MULTICORE_WORKER_COUNT) || 1);
      const configured =
        this.options.maxDiskBytes ??
        Math.floor(Number(process.env.CCH_MEMORY_SPILL_MAX_BYTES || 8 * 1024 ** 3) / workers);
      if (!Number.isSafeInteger(configured) || configured <= 0) throw new LocalCapacityError();
      this.diskLimit = Math.min(
        configured,
        Math.floor((stats.bavail * stats.bsize * 0.1) / workers)
      );
      this.directory = await mkdtemp(path.join(root, spoolPrefix()));
      this.checkActive();
      this.file = await open(path.join(this.directory, "body"), "wx+", 0o600);
      this.checkActive();
      for (const chunk of this.memory.take()) await this.write(chunk);
      this.lease.shrinkTo(this.scratchBytes);
    } catch (error) {
      if (!this.directory) diskBudget.files--;
      throw error instanceof LocalCapacityError ? error : new LocalCapacityError();
    }
  }

  private async write(chunk: Uint8Array): Promise<void> {
    if (!this.file || chunk.byteLength > this.diskLimit - diskBudget.bytes)
      throw new LocalCapacityError();
    diskBudget.bytes += chunk.byteLength;
    this.diskBytes += chunk.byteLength;
    let offset = 0;
    try {
      while (offset < chunk.byteLength) {
        this.checkActive();
        const operation = this.file.write(
          chunk,
          offset,
          Math.min(BLOCK_BYTES, chunk.byteLength - offset)
        );
        const { bytesWritten } = await operation;
        if (bytesWritten <= 0) throw new Error("Short body store write");
        offset += bytesWritten;
      }
    } catch {
      throw new LocalCapacityError();
    }
  }
}
