import { BufferedByteChunks } from "@/app/v1/_lib/proxy/buffered-byte-chunks";
import type { StreamGatePrebufferLease } from "@/app/v1/_lib/proxy/stream-gate/prebuffer-budget";
import { AllocationEstimate } from "@/lib/body-store/allocation-estimate";
import { STORE_SCRATCH_BYTES } from "@/lib/body-store/byte-store";
import { LocalCapacityError } from "@/lib/memory/governor";

/** Discovery 仍使用有界的完整帧解析器；解析与自有前缀块必须共同记账。 */
export class DiscoveryPrebuffer extends BufferedByteChunks {
  private lease: StreamGatePrebufferLease | null = null;
  private estimate = new AllocationEstimate();

  get hasLease(): boolean {
    return this.lease !== null;
  }

  attachLease(lease: StreamGatePrebufferLease | undefined): void {
    if (!lease) return;
    if (this.lease) throw new Error("Discovery prebuffer already owns a lease");
    this.lease = lease;
  }

  /** 在解码、JSON.parse 和块复制之前增长；失败不能持有额度继续等待。 */
  async reserveForParse(chunk: Uint8Array, signal?: AbortSignal): Promise<void> {
    if (!this.lease) return;
    this.estimate.feed(chunk);
    const required = Math.max(
      STORE_SCRATCH_BYTES,
      this.estimate.capacityBytes + this.retainedByteLength + chunk.byteLength + 64 * 1024
    );
    const grown = this.lease.tryGrowAsync
      ? await this.lease.tryGrowAsync(required, signal)
      : this.lease.tryGrow(required);
    if (!grown) throw new LocalCapacityError();
  }

  /** 调用方已丢弃解析器，候选只保留原字节前缀，直到回放消费者接手。 */
  finishParsing(): void {
    this.estimate = new AllocationEstimate();
    this.lease?.shrinkTo(this.retainedByteLength);
  }

  takeOwned(): { chunks: Uint8Array[]; lease: StreamGatePrebufferLease | null } {
    const lease = this.lease;
    this.lease = null;
    return { chunks: this.take(), lease };
  }

  override clear(): void {
    super.clear();
    this.estimate = new AllocationEstimate();
    this.lease?.release();
    this.lease = null;
  }
}
