import { describe, expect, it } from "vitest";
import {
  isThinkingEnabled,
  resolveAnthropicStreamActualResponseModel,
} from "@/app/v1/_lib/proxy/anthropic-actual-response-model";

const REAL_SIGNATURE_BASE64 =
  "EqsDCmMIDhgCKkCrnWTbZMEF0r5uok/aYSgRICLVbOUhwZJhOfCxigdcVkbcTEAsm/33aCjav1PGuQPRqeZ3RAn4VTYmOZUnQHZOMg9jbGF1ZGUtb3B1cy00LTc4AEIIdGhpbmtpbmcSDH4eDs/asAFTgfDkVRoMkNlw68oKoopYj9TnIjCDgiWGjzG1woio60hvwVQRMb0ASwJyYMjZQWqCXTubppc6YpvGLIrhjtJsMfSCC/Qq9QGlGbLsHHRN4ulPmTANpxm1H83mRvzzpkYd96OGTFq/RIjHIA+CVdkiQu57eR0tj/egvnKiD0F0aYp//vOQR7dweMU75+LpNAJKuL6hIR0AwlU92NOp5EaSvO1JBIkzmcgpZyANjMKHwmTziKIqJ3nP8JRaaF/9Zi/xWKymHki7ThrD6hRbY6Kc6UXvFIo44ZmOKQOBlhtau+8ze87cKZVGWa1QyqJfFZgB0dPnD9jEjTLh6hPz9XHKPQsMEz9OZ+DYHs6oJPCms9QxssaqcTpQK4aRh04LMIU+UvkZIPCI7KEzQOXHfRLNZ2uV/EF3n0hbGzVPzRgB";

/**
 * 单事件结尾需要空行(\n\n)来满足 W3C SSE 边界规范;join("\n") 在数组项之间插
 * \n,与每个 chunk 末尾自带的 \n 合并为 \n\n,实现真实事件边界。
 */
function buildMessageStartChunk(model: string): string {
  return [
    "event: message_start",
    `data: ${JSON.stringify({
      type: "message_start",
      message: { type: "message", model },
    })}`,
    "",
  ].join("\n");
}

function buildSignatureDeltaChunk(signature: string): string {
  return [
    "event: content_block_delta",
    `data: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature },
    })}`,
    "",
  ].join("\n");
}

/** Protobuf varint:7 bits/byte,MSB=continuation,LSB first。长度 ≥128 时必须多字节。 */
function encodeVarint(value: number): Buffer {
  const out: number[] = [];
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return Buffer.from(out);
}

/** 构造一个会被 protobuf [2,1,6] 解出 modelText 的合法签名 base64。 */
function buildSignatureBase64ForModel(modelText: string): string {
  const utf8 = Buffer.from(modelText, "utf8");
  const terminal = Buffer.concat([Buffer.from([0x32]), encodeVarint(utf8.length), utf8]);
  const middle = Buffer.concat([Buffer.from([0x0a]), encodeVarint(terminal.length), terminal]);
  const outer = Buffer.concat([Buffer.from([0x12]), encodeVarint(middle.length), middle]);
  return outer.toString("base64");
}

describe("isThinkingEnabled", () => {
  it("thinking.type === 'enabled' → true", () => {
    expect(isThinkingEnabled({ thinking: { type: "enabled", budget_tokens: 32000 } })).toBe(true);
  });

  it("thinking.type === 'adaptive' → true(adaptive 也视为开启)", () => {
    expect(isThinkingEnabled({ thinking: { type: "adaptive" } })).toBe(true);
  });

  it("thinking.type === 'disabled' → false", () => {
    expect(isThinkingEnabled({ thinking: { type: "disabled" } })).toBe(false);
  });

  it("没有 thinking 字段 → false", () => {
    expect(isThinkingEnabled({})).toBe(false);
  });

  it("thinking 不是对象 → false", () => {
    expect(isThinkingEnabled({ thinking: null })).toBe(false);
    expect(isThinkingEnabled({ thinking: "enabled" })).toBe(false);
    expect(isThinkingEnabled({ thinking: true })).toBe(false);
  });

  it("非对象/null/undefined → false,绝不抛", () => {
    expect(isThinkingEnabled(null)).toBe(false);
    expect(isThinkingEnabled(undefined)).toBe(false);
    expect(isThinkingEnabled("string")).toBe(false);
    expect(isThinkingEnabled(42)).toBe(false);
  });
});

describe("resolveAnthropicStreamActualResponseModel", () => {
  it("providerType 不是 Anthropic → source=null(调用方走旧 fallback)", () => {
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "openai-compatible",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: true,
      responseStreamText: buildSignatureDeltaChunk(REAL_SIGNATURE_BASE64),
    });
    expect(result).toEqual({ actualResponseModel: null, source: null });
  });

  it("providerType=null/undefined → source=null", () => {
    expect(
      resolveAnthropicStreamActualResponseModel({
        providerType: null,
        requestedModel: "claude-opus-4-7",
        thinkingEnabled: true,
        responseStreamText: "",
      })
    ).toEqual({ actualResponseModel: null, source: null });
    expect(
      resolveAnthropicStreamActualResponseModel({
        providerType: undefined,
        requestedModel: "claude-opus-4-7",
        thinkingEnabled: false,
        responseStreamText: "",
      })
    ).toEqual({ actualResponseModel: null, source: null });
  });

  it("Anthropic provider + requestedModel 非 Anthropic 模型族(如 glm-4.6) → source=null", () => {
    // GLM 等供应商通过 Anthropic API 协议接入,但响应里没有 thinking signature,
    // 不应触发签名检测,以免错误归类为 fallback_no_signature_with_thinking。
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "glm-4.6",
      thinkingEnabled: true,
      responseStreamText: buildSignatureDeltaChunk(REAL_SIGNATURE_BASE64),
    });
    expect(result).toEqual({ actualResponseModel: null, source: null });
  });

  it("requestedModel=null → source=null", () => {
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: null,
      thinkingEnabled: true,
      responseStreamText: buildSignatureDeltaChunk(REAL_SIGNATURE_BASE64),
    });
    expect(result).toEqual({ actualResponseModel: null, source: null });
  });

  it("requestedModel='claude-opus-4-7' + 签名命中 → source='signature'(即使 message_start 明文不同)", () => {
    const stream = [
      buildMessageStartChunk("claude-haiku-4-5"),
      buildSignatureDeltaChunk(REAL_SIGNATURE_BASE64),
    ].join("\n");
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: true,
      responseStreamText: stream,
    });
    expect(result).toEqual({ actualResponseModel: "claude-opus-4-7", source: "signature" });
  });

  it("requestedModel='anthropic/claude-opus-4' 前缀(聚合供应商命名) → 命中触发", () => {
    const stream = buildSignatureDeltaChunk(REAL_SIGNATURE_BASE64);
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "anthropic/claude-opus-4",
      thinkingEnabled: true,
      responseStreamText: stream,
    });
    expect(result).toEqual({ actualResponseModel: "claude-opus-4-7", source: "signature" });
  });

  it("claude-auth 类型同样走 Anthropic 分支", () => {
    const stream = buildSignatureDeltaChunk(REAL_SIGNATURE_BASE64);
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude-auth",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: false,
      responseStreamText: stream,
    });
    expect(result).toEqual({ actualResponseModel: "claude-opus-4-7", source: "signature" });
  });

  it("无 signature_delta + thinkingEnabled=true + message_start 有效 → fallback_no_signature_with_thinking", () => {
    const stream = buildMessageStartChunk("claude-opus-4-5");
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: true,
      responseStreamText: stream,
    });
    expect(result).toEqual({
      actualResponseModel: "claude-opus-4-5",
      source: "fallback_no_signature_with_thinking",
    });
  });

  it("无 signature_delta + thinkingEnabled=false + message_start 有效 → fallback_no_thinking", () => {
    const stream = buildMessageStartChunk("claude-haiku-4-5");
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: false,
      responseStreamText: stream,
    });
    expect(result).toEqual({
      actualResponseModel: "claude-haiku-4-5",
      source: "fallback_no_thinking",
    });
  });

  it("损坏的 signature base64 + thinkingEnabled=true + message_start 有效 → fallback_no_signature_with_thinking", () => {
    const stream = [
      buildMessageStartChunk("claude-opus-4-5"),
      buildSignatureDeltaChunk("###corrupt!!!"),
    ].join("\n");
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: true,
      responseStreamText: stream,
    });
    expect(result).toEqual({
      actualResponseModel: "claude-opus-4-5",
      source: "fallback_no_signature_with_thinking",
    });
  });

  it("有签名但 protobuf 路径解不出 + thinkingEnabled=true → 同上合并归类", () => {
    // 合法 base64,但 payload 不包含 [2, 1, 6] 路径(例如只有 field 1)
    const decoyB64 = Buffer.from("0a0568656c6c6f", "hex").toString("base64");
    const stream = [
      buildMessageStartChunk("claude-opus-4-5"),
      buildSignatureDeltaChunk(decoyB64),
    ].join("\n");
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: true,
      responseStreamText: stream,
    });
    expect(result).toEqual({
      actualResponseModel: "claude-opus-4-5",
      source: "fallback_no_signature_with_thinking",
    });
  });

  it("签名解出非 claude 字符串(如未来模型家族变革) → 仍然信任(只校验长度)", () => {
    // 例如未来 Anthropic 推 'opus-5-2030' 不再带 claude- 前缀,我们不应误拒
    const futureModelB64 = buildSignatureBase64ForModel("opus-5-2030");
    const stream = [
      buildMessageStartChunk("claude-haiku-4-5"),
      buildSignatureDeltaChunk(futureModelB64),
    ].join("\n");
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: true,
      responseStreamText: stream,
    });
    expect(result).toEqual({ actualResponseModel: "opus-5-2030", source: "signature" });
  });

  it("签名解出的字符串超过 128 字符 → 拒绝(varchar 128 入库限制),fallback 到 message_start", () => {
    const oversized = `claude-${"x".repeat(200)}`;
    const oversizedB64 = buildSignatureBase64ForModel(oversized);
    const stream = [
      buildMessageStartChunk("claude-opus-4-5"),
      buildSignatureDeltaChunk(oversizedB64),
    ].join("\n");
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: true,
      responseStreamText: stream,
    });
    expect(result).toEqual({
      actualResponseModel: "claude-opus-4-5",
      source: "fallback_no_signature_with_thinking",
    });
  });

  it("响应流为空 + thinkingEnabled=true → fallback_no_thinking(无 message_start 不算异常,避免误告警)", () => {
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: true,
      responseStreamText: "",
    });
    expect(result).toEqual({ actualResponseModel: null, source: "fallback_no_thinking" });
  });

  it("响应流为空 + thinkingEnabled=false → fallback_no_thinking,模型为 null", () => {
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: false,
      responseStreamText: "",
    });
    expect(result).toEqual({ actualResponseModel: null, source: "fallback_no_thinking" });
  });

  it("responseStreamText=null 安全处理", () => {
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: true,
      responseStreamText: null,
    });
    expect(result).toEqual({ actualResponseModel: null, source: "fallback_no_thinking" });
  });
});
