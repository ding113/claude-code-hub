import { describe, expect, it } from "vitest";
import {
  isThinkingEnabled,
  resolveAnthropicStreamActualResponseModel,
} from "@/app/v1/_lib/proxy/anthropic-actual-response-model";

const REAL_SIGNATURE_BASE64 =
  "EqsDCmMIDhgCKkCrnWTbZMEF0r5uok/aYSgRICLVbOUhwZJhOfCxigdcVkbcTEAsm/33aCjav1PGuQPRqeZ3RAn4VTYmOZUnQHZOMg9jbGF1ZGUtb3B1cy00LTc4AEIIdGhpbmtpbmcSDH4eDs/asAFTgfDkVRoMkNlw68oKoopYj9TnIjCDgiWGjzG1woio60hvwVQRMb0ASwJyYMjZQWqCXTubppc6YpvGLIrhjtJsMfSCC/Qq9QGlGbLsHHRN4ulPmTANpxm1H83mRvzzpkYd96OGTFq/RIjHIA+CVdkiQu57eR0tj/egvnKiD0F0aYp//vOQR7dweMU75+LpNAJKuL6hIR0AwlU92NOp5EaSvO1JBIkzmcgpZyANjMKHwmTziKIqJ3nP8JRaaF/9Zi/xWKymHki7ThrD6hRbY6Kc6UXvFIo44ZmOKQOBlhtau+8ze87cKZVGWa1QyqJfFZgB0dPnD9jEjTLh6hPz9XHKPQsMEz9OZ+DYHs6oJPCms9QxssaqcTpQK4aRh04LMIU+UvkZIPCI7KEzQOXHfRLNZ2uV/EF3n0hbGzVPzRgB";

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
  it("providerType 不是 Anthropic → source=null,actualResponseModel=null(调用方自处理)", () => {
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "openai-compatible",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: true,
      responseStreamText: buildSignatureDeltaChunk(REAL_SIGNATURE_BASE64),
    });
    expect(result).toEqual({ actualResponseModel: null, source: null });
  });

  it("requestedModel 不以 claude- 开头 → source=null", () => {
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "gpt-4",
      thinkingEnabled: true,
      responseStreamText: buildSignatureDeltaChunk(REAL_SIGNATURE_BASE64),
    });
    expect(result).toEqual({ actualResponseModel: null, source: null });
  });

  it("requestedModel 为 null → source=null(无从判断)", () => {
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: null,
      thinkingEnabled: true,
      responseStreamText: buildSignatureDeltaChunk(REAL_SIGNATURE_BASE64),
    });
    expect(result).toEqual({ actualResponseModel: null, source: null });
  });

  it("Anthropic + claude- + 签名命中 → source='signature',模型取签名结果(即使 message_start 明文不同)", () => {
    const stream = [
      buildMessageStartChunk("claude-haiku-4-5"), // 故意与签名不同
      buildSignatureDeltaChunk(REAL_SIGNATURE_BASE64),
    ].join("");
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: true,
      responseStreamText: stream,
    });
    expect(result).toEqual({ actualResponseModel: "claude-opus-4-7", source: "signature" });
  });

  it("claude-auth 类型也走相同分支", () => {
    const stream = buildSignatureDeltaChunk(REAL_SIGNATURE_BASE64);
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude-auth",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: false, // 即使关了 thinking,但既然有签名,直接取签名
      responseStreamText: stream,
    });
    expect(result).toEqual({ actualResponseModel: "claude-opus-4-7", source: "signature" });
  });

  it("无 signature_delta + thinkingEnabled=true → source='fallback_no_signature_with_thinking',模型取 message_start 明文", () => {
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

  it("无 signature_delta + thinkingEnabled=false → source='fallback_no_thinking',模型取 message_start 明文", () => {
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

  it("损坏的 signature base64 + thinkingEnabled=true → 合并归到 fallback_no_signature_with_thinking", () => {
    const stream = [
      buildMessageStartChunk("claude-opus-4-5"),
      buildSignatureDeltaChunk("###corrupt!!!"),
    ].join("");
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
    ].join("");
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

  it("响应流为空且 thinkingEnabled=true → fallback_no_signature_with_thinking,模型为 null", () => {
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: true,
      responseStreamText: "",
    });
    expect(result).toEqual({
      actualResponseModel: null,
      source: "fallback_no_signature_with_thinking",
    });
  });

  it("响应流为空且 thinkingEnabled=false → fallback_no_thinking,模型为 null", () => {
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "claude-opus-4-7",
      thinkingEnabled: false,
      responseStreamText: "",
    });
    expect(result).toEqual({ actualResponseModel: null, source: "fallback_no_thinking" });
  });

  it("requestedModel 大小写敏感:Claude- 开头(大写 C) → source=null,不触发", () => {
    const result = resolveAnthropicStreamActualResponseModel({
      providerType: "claude",
      requestedModel: "Claude-opus-4-7",
      thinkingEnabled: true,
      responseStreamText: buildSignatureDeltaChunk(REAL_SIGNATURE_BASE64),
    });
    expect(result).toEqual({ actualResponseModel: null, source: null });
  });
});
