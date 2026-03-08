import { describe, expect, it } from "vitest";
import { rectifyResponseInput } from "@/app/v1/_lib/proxy/response-input-rectifier";

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
