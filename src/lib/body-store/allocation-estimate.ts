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

  /**
   * 解析完成后请求在整个生命周期内持续持有的工作集：原始字节、对象中的字符串
   * （UTF-16 最多两倍）、对象结构与一份出站序列化副本。解析临时值已可回收，
   * 长时间流式响应期间不能继续按解析峰值占用额度。
   */
  get retainedBytes(): number {
    return 8192 + this.bytes * 4 + this.structureBytes;
  }
}
