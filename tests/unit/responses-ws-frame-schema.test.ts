import { describe, expect, it } from "vitest";
import {
  parseResponsesWsInitialFrame,
  serializeResponsesWsFrame,
} from "@/app/v1/_lib/proxy/responses-ws-schema";

describe("responses websocket frame schema", () => {
  it("accepts valid response.create", () => {
    const encryptedContent = "enc_01HZZZZZZZZZZZZZZZZZZ==";
    const frame = parseResponsesWsInitialFrame({
      type: "response.create",
      response: {
        model: "gpt-5-codex",
        input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
        previous_response_id: "resp_123",
        prompt_cache_key: "cache_123",
        service_tier: "flex",
        generate: false,
        reasoning: {
          summary: "auto",
          encrypted_content: encryptedContent,
          custom_hint: "keep-me",
        },
      },
    });

    expect(frame.response.service_tier).toBe("flex");
    expect(frame.response.generate).toBe(false);
    expect(frame.response.previous_response_id).toBe("resp_123");
    expect(frame.response.reasoning?.summary).toBe("auto");
    expect(frame.response.reasoning?.encrypted_content).toBe(encryptedContent);
    expect(frame.response.reasoning).toMatchObject({ custom_hint: "keep-me" });

    const serialized = serializeResponsesWsFrame(frame);
    expect(serialized).toContain(`"encrypted_content":"${encryptedContent}"`);
  });

  it("rejects malformed first frame", () => {
    expect(() =>
      parseResponsesWsInitialFrame({
        type: "response.create",
        response: {
          model: "gpt-5-codex",
          service_tier: "turbo",
        },
      })
    ).toThrow();

    expect(() =>
      parseResponsesWsInitialFrame({
        response: {
          model: "gpt-5-codex",
        },
      })
    ).toThrow();
  });

  it("preserves encrypted_content byte-for-byte through validation and serialization", () => {
    const encryptedContent = "ZXhhY3QtYnl0ZXMtMDEyMzQ1Njc4OQ==";
    const frame = parseResponsesWsInitialFrame({
      type: "response.create",
      response: {
        model: "gpt-5-codex",
        reasoning: {
          encrypted_content: encryptedContent,
        },
      },
    });

    expect(frame.response.reasoning?.encrypted_content).toBe(encryptedContent);
    expect(serializeResponsesWsFrame(frame)).toContain(encryptedContent);
  });
});
