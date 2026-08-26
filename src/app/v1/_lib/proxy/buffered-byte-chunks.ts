const DEFAULT_MIN_BLOCK_BYTES = 1024;
const DEFAULT_MAX_BLOCK_BYTES = 64 * 1024;

/** 把任意输入碎片复制到少量、有界数量的自有字节块中。 */
export class BufferedByteChunks {
  private chunks: Uint8Array[] = [];
  private tail: Uint8Array | null = null;
  private tailBytes = 0;
  private nextBlockBytes: number;

  constructor(
    private readonly minBlockBytes = DEFAULT_MIN_BLOCK_BYTES,
    private readonly maxBlockBytes = DEFAULT_MAX_BLOCK_BYTES
  ) {
    if (minBlockBytes <= 0 || maxBlockBytes < minBlockBytes) {
      throw new RangeError("Invalid buffered byte block sizes");
    }
    this.nextBlockBytes = minBlockBytes;
  }

  /** 当前块及已封存块实际占用的 backing bytes（含尾块未使用容量）。 */
  get retainedByteLength(): number {
    let total = this.tail?.byteLength ?? 0;
    for (const chunk of this.chunks) total += chunk.byteLength;
    return total;
  }

  append(source: Uint8Array): void {
    let offset = 0;
    while (offset < source.byteLength) {
      if (!this.tail) {
        const remaining = source.byteLength - offset;
        const blockBytes =
          remaining >= this.maxBlockBytes
            ? this.maxBlockBytes
            : Math.min(this.maxBlockBytes, Math.max(this.nextBlockBytes, remaining));
        this.tail = new Uint8Array(blockBytes);
        this.tailBytes = 0;
      }

      const writableBytes = this.tail.byteLength - this.tailBytes;
      const copiedBytes = Math.min(writableBytes, source.byteLength - offset);
      this.tail.set(source.subarray(offset, offset + copiedBytes), this.tailBytes);
      this.tailBytes += copiedBytes;
      offset += copiedBytes;

      if (this.tailBytes === this.tail.byteLength) {
        this.chunks.push(this.tail);
        this.tail = null;
        this.tailBytes = 0;
        this.nextBlockBytes = Math.min(this.maxBlockBytes, this.nextBlockBytes * 2);
      }
    }
  }

  take(): Uint8Array[] {
    if (this.tail && this.tailBytes > 0) {
      this.chunks.push(this.tail.subarray(0, this.tailBytes));
    }
    const chunks = this.chunks;
    this.chunks = [];
    this.tail = null;
    this.tailBytes = 0;
    this.nextBlockBytes = this.minBlockBytes;
    return chunks;
  }

  clear(): void {
    this.chunks = [];
    this.tail = null;
    this.tailBytes = 0;
    this.nextBlockBytes = this.minBlockBytes;
  }
}
