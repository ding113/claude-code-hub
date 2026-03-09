import { describe, expect, it, vi } from "vitest";
import {
  normalizeResponseInput,
  rectifyResponseInput,
} from "@/app/v1/_lib/proxy/response-input-rectifier";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { SpecialSetting } from "@/types/special-settings";

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");
const getCachedMock = vi.mocked(getCachedSystemSettings);

function createMockSession(input: unknown): {
  session: ProxySession;
  specialSettings: SpecialSetting[];
} {
  const specialSettings: SpecialSetting[] = [];
  const session = {
    request: { message: { model: "gpt-4o", input } },
    sessionId: "sess_test",
    addSpecialSetting: (s: SpecialSetting) => specialSettings.push(s),
  } as unknown as ProxySession;
  return { session, specialSettings };
}

describe("rectifyResponseInput", () => {
  // --- Passthrough cases ---

  it("passes through array input unchanged", () => {
    const message: Record<string, unknown> = {
      model: "gpt-4o",
      input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
    };
    const original = message.input;

    const result = rectifyResponseInput(message);

    expect(result).toEqual({ applied: false, action: "passthrough", originalType: "array" });
    expect(message.input).toBe(original);
  });

  it("passes through empty array input unchanged", () => {
    const message: Record<string, unknown> = { input: [] };
    const result = rectifyResponseInput(message);

    expect(result).toEqual({ applied: false, action: "passthrough", originalType: "array" });
    expect(message.input).toEqual([]);
  });

  it("passes through undefined input", () => {
    const message: Record<string, unknown> = { model: "gpt-4o" };
    const result = rectifyResponseInput(message);

    expect(result).toEqual({ applied: false, action: "passthrough", originalType: "other" });
    expect(message.input).toBeUndefined();
  });

  it("passes through null input", () => {
    const message: Record<string, unknown> = { input: null };
    const result = rectifyResponseInput(message);

    expect(result).toEqual({ applied: false, action: "passthrough", originalType: "other" });
    expect(message.input).toBeNull();
  });

  // --- String normalization ---

  it("normalizes non-empty string to user message array", () => {
    const message: Record<string, unknown> = { model: "gpt-4o", input: "hello world" };
    const result = rectifyResponseInput(message);

    expect(result).toEqual({ applied: true, action: "string_to_array", originalType: "string" });
    expect(message.input).toEqual([
      {
        role: "user",
        content: [{ type: "input_text", text: "hello world" }],
      },
    ]);
  });

  it("normalizes empty string to empty array", () => {
    const message: Record<string, unknown> = { input: "" };
    const result = rectifyResponseInput(message);

    expect(result).toEqual({
      applied: true,
      action: "empty_string_to_empty_array",
      originalType: "string",
    });
    expect(message.input).toEqual([]);
  });

  it("normalizes whitespace-only string to user message (not empty)", () => {
    const message: Record<string, unknown> = { input: "  " };
    const result = rectifyResponseInput(message);

    expect(result).toEqual({ applied: true, action: "string_to_array", originalType: "string" });
    expect(message.input).toEqual([
      {
        role: "user",
        content: [{ type: "input_text", text: "  " }],
      },
    ]);
  });

  it("normalizes multiline string", () => {
    const message: Record<string, unknown> = { input: "line1\nline2\nline3" };
    const result = rectifyResponseInput(message);

    expect(result).toEqual({ applied: true, action: "string_to_array", originalType: "string" });
    expect(message.input).toEqual([
      {
        role: "user",
        content: [{ type: "input_text", text: "line1\nline2\nline3" }],
      },
    ]);
  });

  // --- Object normalization ---

  it("wraps single MessageInput (has role) into array", () => {
    const inputObj = { role: "user", content: [{ type: "input_text", text: "hi" }] };
    const message: Record<string, unknown> = { input: inputObj };
    const result = rectifyResponseInput(message);

    expect(result).toEqual({ applied: true, action: "object_to_array", originalType: "object" });
    expect(message.input).toEqual([inputObj]);
  });

  it("wraps single ToolOutputsInput (has type) into array", () => {
    const inputObj = { type: "function_call_output", call_id: "call_123", output: "result" };
    const message: Record<string, unknown> = { input: inputObj };
    const result = rectifyResponseInput(message);

    expect(result).toEqual({ applied: true, action: "object_to_array", originalType: "object" });
    expect(message.input).toEqual([inputObj]);
  });

  it("passes through object without role or type", () => {
    const message: Record<string, unknown> = { input: { foo: "bar", baz: 42 } };
    const result = rectifyResponseInput(message);

    expect(result).toEqual({ applied: false, action: "passthrough", originalType: "other" });
  });

  // --- Edge cases ---

  it("does not modify other message fields", () => {
    const message: Record<string, unknown> = {
      model: "gpt-4o",
      input: "hello",
      temperature: 0.7,
      stream: true,
    };
    rectifyResponseInput(message);

    expect(message.model).toBe("gpt-4o");
    expect(message.temperature).toBe(0.7);
    expect(message.stream).toBe(true);
  });

  it("passes through numeric input as other", () => {
    const message: Record<string, unknown> = { input: 42 };
    const result = rectifyResponseInput(message);

    expect(result).toEqual({ applied: false, action: "passthrough", originalType: "other" });
  });

  it("passes through boolean input as other", () => {
    const message: Record<string, unknown> = { input: true };
    const result = rectifyResponseInput(message);

    expect(result).toEqual({ applied: false, action: "passthrough", originalType: "other" });
  });
});

describe("normalizeResponseInput", () => {
  it("normalizes string input and records audit when enabled", async () => {
    getCachedMock.mockResolvedValue({ enableResponseInputRectifier: true } as any);

    const { session, specialSettings } = createMockSession("hello");
    await normalizeResponseInput(session);

    const message = session.request.message as Record<string, unknown>;
    expect(message.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "hello" }] },
    ]);
    expect(specialSettings).toHaveLength(1);
    expect(specialSettings[0]).toMatchObject({
      type: "response_input_rectifier",
      hit: true,
      action: "string_to_array",
      originalType: "string",
    });
  });

  it("skips normalization when feature is disabled", async () => {
    getCachedMock.mockResolvedValue({ enableResponseInputRectifier: false } as any);

    const { session, specialSettings } = createMockSession("hello");
    await normalizeResponseInput(session);

    const message = session.request.message as Record<string, unknown>;
    expect(message.input).toBe("hello");
    expect(specialSettings).toHaveLength(0);
  });

  it("does not record audit for passthrough (array input)", async () => {
    getCachedMock.mockResolvedValue({ enableResponseInputRectifier: true } as any);

    const arrayInput = [{ role: "user", content: [{ type: "input_text", text: "hi" }] }];
    const { session, specialSettings } = createMockSession(arrayInput);
    await normalizeResponseInput(session);

    const message = session.request.message as Record<string, unknown>;
    expect(message.input).toBe(arrayInput);
    expect(specialSettings).toHaveLength(0);
  });

  it("wraps single object input and records audit when enabled", async () => {
    getCachedMock.mockResolvedValue({ enableResponseInputRectifier: true } as any);

    const inputObj = { role: "user", content: [{ type: "input_text", text: "hi" }] };
    const { session, specialSettings } = createMockSession(inputObj);
    await normalizeResponseInput(session);

    const message = session.request.message as Record<string, unknown>;
    expect(message.input).toEqual([inputObj]);
    expect(specialSettings).toHaveLength(1);
    expect(specialSettings[0]).toMatchObject({
      type: "response_input_rectifier",
      action: "object_to_array",
      originalType: "object",
    });
  });
});
