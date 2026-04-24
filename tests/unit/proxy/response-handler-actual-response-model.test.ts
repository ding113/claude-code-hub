import { describe, expect, it } from "vitest";
import { extractActualResponseModelForProvider } from "@/app/v1/_lib/proxy/actual-response-model";
import { GeminiAdapter } from "@/app/v1/_lib/gemini/adapter";
import type { GeminiResponse } from "@/app/v1/_lib/gemini/types";

/**
 * Runtime-level smoke test: verify the extraction + buffer-patch pipeline wires actualResponseModel
 * through without disturbing `model` (which is the billing/effective request model).
 *
 * Deep E2E response-handler tests exist separately; this file focuses on the three
 * invariants the plan guarantees:
 *   1. `actualResponseModel` is extracted per upstream provider type (8 cases)
 *   2. When extraction fails (aborted / malformed / missing), return `null` — never throw
 *   3. Gemini transform path no longer emits the `"gemini-model"` placeholder when the
 *      upstream response actually carries `modelVersion`.
 */

describe("extractActualResponseModelForProvider (runtime helper, provider-type-aware)", () => {
  it("claude provider + non-stream body -> Anthropic $.model", () => {
    const body = JSON.stringify({
      type: "message",
      model: "claude-opus-4-7",
      content: [],
    });
    expect(extractActualResponseModelForProvider("claude", false, body)).toBe("claude-opus-4-7");
  });

  it("claude-auth provider + stream message_start -> $.message.model", () => {
    const stream = [
      "event: message_start",
      `data: ${JSON.stringify({
        type: "message_start",
        message: { type: "message", model: "claude-opus-4-7", content: [] },
      })}`,
      "",
    ].join("\n");
    expect(extractActualResponseModelForProvider("claude-auth", true, stream)).toBe(
      "claude-opus-4-7"
    );
  });

  it("openai-compatible non-stream -> $.model", () => {
    const body = JSON.stringify({ object: "chat.completion", model: "gpt-4o-mini", choices: [] });
    expect(extractActualResponseModelForProvider("openai-compatible", false, body)).toBe(
      "gpt-4o-mini"
    );
  });

  it("codex provider + non-stream -> Responses $.model (real version vs alias)", () => {
    const body = JSON.stringify({ object: "response", model: "gpt-4.1-2025-04-14", output: [] });
    expect(extractActualResponseModelForProvider("codex", false, body)).toBe("gpt-4.1-2025-04-14");
  });

  it("codex provider + stream -> $.response.model from envelope event", () => {
    const stream = [
      "event: response.created",
      `data: ${JSON.stringify({
        type: "response.created",
        response: { model: "gpt-4.1-2025-04-14" },
      })}`,
      "",
    ].join("\n");
    expect(extractActualResponseModelForProvider("codex", true, stream)).toBe("gpt-4.1-2025-04-14");
  });

  it("gemini provider + non-stream -> $.modelVersion (NOT $.model)", () => {
    const body = JSON.stringify({
      candidates: [],
      modelVersion: "gemini-2.5-flash-lite",
      responseId: "abc",
    });
    expect(extractActualResponseModelForProvider("gemini", false, body)).toBe(
      "gemini-2.5-flash-lite"
    );
  });

  it("gemini-cli provider + stream -> first chunk $.modelVersion", () => {
    const stream = [
      `data: ${JSON.stringify({ candidates: [], modelVersion: "gemini-2.5-flash" })}`,
      "",
    ].join("\n");
    expect(extractActualResponseModelForProvider("gemini-cli", true, stream)).toBe(
      "gemini-2.5-flash"
    );
  });

  it("returns null on null/undefined body (aborted branches must not throw)", () => {
    expect(extractActualResponseModelForProvider("claude", false, null)).toBeNull();
    expect(extractActualResponseModelForProvider("openai-compatible", true, undefined)).toBeNull();
    expect(extractActualResponseModelForProvider(undefined, false, "{}")).toBeNull();
  });

  it("returns null on malformed body without throwing", () => {
    expect(extractActualResponseModelForProvider("claude", false, "not-json")).toBeNull();
    expect(extractActualResponseModelForProvider("gemini", true, "data: {broken\n\n")).toBeNull();
  });
});

describe("GeminiAdapter.transformResponse placeholder fix", () => {
  it("non-stream: uses upstream modelVersion instead of 'gemini-model' placeholder", () => {
    const response: GeminiResponse = {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "hi" }] },
          finishReason: "STOP",
          index: 0,
        },
      ],
      modelVersion: "gemini-2.5-flash",
    };
    const transformed = GeminiAdapter.transformResponse(response, false);
    expect(transformed.model).toBe("gemini-2.5-flash");
  });

  it("stream: uses upstream modelVersion instead of 'gemini-model' placeholder", () => {
    const chunk: GeminiResponse = {
      candidates: [{ content: { role: "model", parts: [{ text: "h" }] }, index: 0 }],
      modelVersion: "gemini-2.5-flash-lite",
    };
    const transformed = GeminiAdapter.transformResponse(chunk, true);
    expect(transformed.model).toBe("gemini-2.5-flash-lite");
  });

  it("falls back to 'gemini-model' placeholder when upstream omits modelVersion", () => {
    const response: GeminiResponse = {
      candidates: [],
    };
    const transformed = GeminiAdapter.transformResponse(response, false);
    expect(transformed.model).toBe("gemini-model");
  });

  it("accepts snake_case model_version as well (SDK shape)", () => {
    const response = {
      candidates: [],
      model_version: "gemini-2.5-flash",
    } as GeminiResponse;
    const transformed = GeminiAdapter.transformResponse(response, false);
    expect(transformed.model).toBe("gemini-2.5-flash");
  });
});
