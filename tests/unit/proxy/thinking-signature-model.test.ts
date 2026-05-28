import { describe, expect, it } from "vitest";
import {
  decodeThinkingSignatureModel,
  extractThinkingSignatureModelFromStream,
} from "@/app/v1/_lib/proxy/thinking-signature-model";

/**
 * Anthropic thinking signature 真实样例（来自需求中提供的 SSE chunk）。
 * 字段路径 [2, 1, 6] 应解出 "claude-opus-4-7"。
 */
const REAL_SIGNATURE_BASE64 =
  "EqsDCmMIDhgCKkCrnWTbZMEF0r5uok/aYSgRICLVbOUhwZJhOfCxigdcVkbcTEAsm/33aCjav1PGuQPRqeZ3RAn4VTYmOZUnQHZOMg9jbGF1ZGUtb3B1cy00LTc4AEIIdGhpbmtpbmcSDH4eDs/asAFTgfDkVRoMkNlw68oKoopYj9TnIjCDgiWGjzG1woio60hvwVQRMb0ASwJyYMjZQWqCXTubppc6YpvGLIrhjtJsMfSCC/Qq9QGlGbLsHHRN4ulPmTANpxm1H83mRvzzpkYd96OGTFq/RIjHIA+CVdkiQu57eR0tj/egvnKiD0F0aYp//vOQR7dweMU75+LpNAJKuL6hIR0AwlU92NOp5EaSvO1JBIkzmcgpZyANjMKHwmTziKIqJ3nP8JRaaF/9Zi/xWKymHki7ThrD6hRbY6Kc6UXvFIo44ZmOKQOBlhtau+8ze87cKZVGWa1QyqJfFZgB0dPnD9jEjTLh6hPz9XHKPQsMEz9OZ+DYHs6oJPCms9QxssaqcTpQK4aRh04LMIU+UvkZIPCI7KEzQOXHfRLNZ2uV/EF3n0hbGzVPzRgB";

/** 把 hex 字符串构造成 protobuf payload 的 base64。 */
function buildBase64FromHex(hex: string): string {
  return Buffer.from(hex.replace(/\s+/g, ""), "hex").toString("base64");
}

/**
 * 构造嵌套 protobuf:
 *   { field 2: { field 1: { field 6: "<modelText>" } } }
 *
 * Wire layout (大端可读视角):
 *   outer:  0x12 (tag field=2 wire=2) <len> <inner>
 *   middle: 0x0a (tag field=1 wire=2) <len> <terminal>
 *   terminal: 0x32 (tag field=6 wire=2) <len> <utf8 bytes of modelText>
 */
function buildNestedModelBase64(modelText: string): string {
  const utf8 = Buffer.from(modelText, "utf8");
  const terminal = Buffer.concat([Buffer.from([0x32, utf8.length]), utf8]);
  const middle = Buffer.concat([Buffer.from([0x0a, terminal.length]), terminal]);
  const outer = Buffer.concat([Buffer.from([0x12, middle.length]), middle]);
  return outer.toString("base64");
}

describe("decodeThinkingSignatureModel", () => {
  it("解出真实样例 → claude-opus-4-7", () => {
    expect(decodeThinkingSignatureModel(REAL_SIGNATURE_BASE64)).toBe("claude-opus-4-7");
  });

  it("默认路径 [2,1,6] 可被覆写,自定义路径也能解析", () => {
    // 自构造:仅有 field 6 直接含字符串(单层)
    const single = buildBase64FromHex(`32 05 68 65 6c 6c 6f`); // field 6 "hello"
    expect(decodeThinkingSignatureModel(single, [6])).toBe("hello");
  });

  it("两层嵌套自定义路径 [3, 1] (其中 field 3 wire 2 嵌套, field 1 wire 2 string)", () => {
    // inner: 0x0a (field 1 wire 2) 0x03 "abc" → 5 bytes
    // outer: 0x1a (field 3 wire 2) 0x05 + inner → 7 bytes
    const b64 = buildBase64FromHex(`1a 05 0a 03 61 62 63`);
    expect(decodeThinkingSignatureModel(b64, [3, 1])).toBe("abc");
  });

  it("空字符串输入 → null", () => {
    expect(decodeThinkingSignatureModel("")).toBeNull();
  });

  it("非法 base64(含非法字符)→ null", () => {
    expect(decodeThinkingSignatureModel("!!!not_base64!!!")).toBeNull();
  });

  it("截断的 protobuf → null", () => {
    // 取真实样例前 10 字节,几乎肯定截断在 varint 中间
    const truncated = Buffer.from(REAL_SIGNATURE_BASE64, "base64").subarray(0, 10);
    expect(decodeThinkingSignatureModel(truncated.toString("base64"))).toBeNull();
  });

  it("字段路径不存在(payload 没有 field 2)→ null", () => {
    // 只构造 field 1 的简单消息
    const b64 = buildBase64FromHex(`0a 03 78 79 7a`);
    expect(decodeThinkingSignatureModel(b64)).toBeNull();
  });

  it("终点字段 wire-type 不是 length-delimited → null", () => {
    // 终点 [2,1,6] 但 field 6 是 varint(wire 0,tag=0x30 = 48)
    // outer field 2 = { field 1 = { field 6 = varint 7 } }
    // inner_terminal: 0x30 0x07 (varint field 6 = 7)
    // middle:         0x0a 0x02 + terminal = 4 bytes
    // outer:          0x12 0x04 + middle = 6 bytes
    const b64 = buildBase64FromHex(`12 04 0a 02 30 07`);
    expect(decodeThinkingSignatureModel(b64)).toBeNull();
  });

  it("中间路径字段 wire-type 不是 length-delimited → null", () => {
    // outer field 2 是 varint(wire 0,tag=0x10)
    // 0x10 0x05  (varint field 2 = 5)
    const b64 = buildBase64FromHex(`10 05`);
    expect(decodeThinkingSignatureModel(b64)).toBeNull();
  });

  it("能解析任意 utf-8 字符串(包括短名/带连字符)", () => {
    expect(decodeThinkingSignatureModel(buildNestedModelBase64("c"), [2, 1, 6])).toBe("c");
    expect(decodeThinkingSignatureModel(buildNestedModelBase64("claude-haiku-4-7"))).toBe(
      "claude-haiku-4-7"
    );
  });

  it("null/undefined 输入 → null,绝不抛", () => {
    expect(decodeThinkingSignatureModel(null as unknown as string)).toBeNull();
    expect(decodeThinkingSignatureModel(undefined as unknown as string)).toBeNull();
  });
});

describe("extractThinkingSignatureModelFromStream", () => {
  const realSseBlock = [
    "event: content_block_delta",
    `data: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: REAL_SIGNATURE_BASE64 },
    })}`,
    "",
  ].join("\n");

  it("完整 SSE 流命中,解出 claude-opus-4-7", () => {
    const stream = [
      "event: message_start",
      `data: ${JSON.stringify({
        type: "message_start",
        message: { type: "message", model: "claude-haiku-4-7" }, // 故意与签名不同
      })}`,
      "",
      "event: content_block_start",
      `data: ${JSON.stringify({ type: "content_block_start", index: 0 })}`,
      "",
      realSseBlock,
      "data: [DONE]",
      "",
    ].join("\n");
    expect(extractThinkingSignatureModelFromStream(stream)).toBe("claude-opus-4-7");
  });

  it("流中没有 signature_delta → null", () => {
    const stream = [
      "event: message_start",
      `data: ${JSON.stringify({
        type: "message_start",
        message: { type: "message", model: "claude-opus-4-5" },
      })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    expect(extractThinkingSignatureModelFromStream(stream)).toBeNull();
  });

  it("首个 signature 损坏,后续 signature 正常 → 取后续", () => {
    const goodB64 = buildNestedModelBase64("claude-fallback-7");
    const stream = [
      "event: content_block_delta",
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "!!!corrupt!!!" },
      })}`,
      "",
      "event: content_block_delta",
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 1,
        delta: { type: "signature_delta", signature: goodB64 },
      })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    expect(extractThinkingSignatureModelFromStream(stream)).toBe("claude-fallback-7");
  });

  it("非 signature_delta 的 delta 应跳过(text_delta/input_json_delta)", () => {
    const stream = [
      "event: content_block_delta",
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "hi" },
      })}`,
      "",
      "event: content_block_delta",
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 1,
        delta: { type: "signature_delta", signature: REAL_SIGNATURE_BASE64 },
      })}`,
      "",
    ].join("\n");
    expect(extractThinkingSignatureModelFromStream(stream)).toBe("claude-opus-4-7");
  });

  it("空字符串 / 仅注释 / 只有 [DONE] → null", () => {
    expect(extractThinkingSignatureModelFromStream("")).toBeNull();
    expect(extractThinkingSignatureModelFromStream(": ping\n\ndata: [DONE]\n")).toBeNull();
  });

  it("所有 signature 都损坏 → null", () => {
    const stream = [
      "event: content_block_delta",
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "###" },
      })}`,
      "",
      "event: content_block_delta",
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 1,
        delta: { type: "signature_delta", signature: "@@@" },
      })}`,
      "",
    ].join("\n");
    expect(extractThinkingSignatureModelFromStream(stream)).toBeNull();
  });

  it("自定义 fieldPath 透传给 decoder", () => {
    const b64 = buildBase64FromHex(`32 05 68 65 6c 6c 6f`);
    const stream = [
      "event: content_block_delta",
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: b64 },
      })}`,
      "",
    ].join("\n");
    expect(extractThinkingSignatureModelFromStream(stream, [6])).toBe("hello");
  });

  it("null / undefined / 非字符串输入 → null", () => {
    expect(extractThinkingSignatureModelFromStream(null as unknown as string)).toBeNull();
    expect(extractThinkingSignatureModelFromStream(undefined as unknown as string)).toBeNull();
  });
});
