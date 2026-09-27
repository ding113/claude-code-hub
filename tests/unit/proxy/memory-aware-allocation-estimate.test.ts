import { describe, expect, it } from "vitest";
import { AllocationEstimate } from "@/lib/body-store/allocation-estimate";

describe("请求物化容量估算", () => {
  it("同样长度的小对象集合比长文本需要更多容量", () => {
    const objects = new TextEncoder().encode(
      JSON.stringify(Array.from({ length: 1000 }, () => ({})))
    );
    const text = new TextEncoder().encode(JSON.stringify("a".repeat(objects.length - 2)));
    const a = new AllocationEstimate();
    a.feed(objects);
    const b = new AllocationEstimate();
    b.feed(text);
    expect(a.capacityBytes).toBeGreaterThan(b.capacityBytes * 4);
  });
  it("跨块的引号与转义不将字符串内容计为对象结构", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ key: '"[{},:]\\你好' }));
    const whole = new AllocationEstimate();
    whole.feed(bytes);
    const split = new AllocationEstimate();
    for (const byte of bytes) split.feed(new Uint8Array([byte]));
    expect(split.capacityBytes).toBe(whole.capacityBytes);
    expect(whole.capacityBytes).toBe(8192 + bytes.length * 8 + 80 + 64);
  });
});
