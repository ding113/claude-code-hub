/** 只扫描字节，不构造 AST；密集的小对象/数组不能按正文长度低估 V8 物化开销。 */
export class AllocationEstimate {
  private bytes = 0;
  private structureBytes = 0;
  private quoted = false;
  private escaped = false;

  feed(chunk: Uint8Array): void {
    this.bytes += chunk.byteLength;
    for (const byte of chunk) {
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (byte === 92) this.escaped = true;
        else if (byte === 34) this.quoted = false;
      } else if (byte === 34) this.quoted = true;
      else if (byte === 123 || byte === 91) this.structureBytes += 80;
      else if (byte === 58) this.structureBytes += 64;
      else if (byte === 44) this.structureBytes += 32;
    }
  }

  get capacityBytes(): number {
    // 明文字节、UTF-16 解析临时值、对象中的字符串及出站序列化工作集。
    return 8192 + this.bytes * 8 + this.structureBytes;
  }
}
