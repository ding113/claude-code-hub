import { describe, expect, test } from "vitest";
import {
  isTerminalEvent,
  parseClientFrame,
  parseServerError,
  parseTerminalEvent,
} from "@/lib/ws/frame-parser";

// ---------------------------------------------------------------------------
// parseClientFrame
// ---------------------------------------------------------------------------

describe("parseClientFrame", () => {
  test("returns ok:true for valid JSON frame", () => {
    const raw = JSON.stringify({
      type: "response.create",
      response: { model: "gpt-4o" },
    });

    const result = parseClientFrame(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.type).toBe("response.create");
    }
  });

  test("returns ok:false with descriptive error for invalid JSON", () => {
    const result = parseClientFrame("{not valid json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Invalid JSON");
    }
  });

  test("returns ok:false for valid JSON that fails schema", () => {
    const raw = JSON.stringify({ type: "response.create", response: {} });
    const result = parseClientFrame(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  test("handles binary Buffer input", () => {
    const payload = JSON.stringify({
      type: "response.create",
      response: { model: "gpt-4o" },
    });
    const buf = Buffer.from(payload, "utf-8");

    const result = parseClientFrame(buf);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.type).toBe("response.create");
    }
  });

  test("accepts response.cancel frame", () => {
    const raw = JSON.stringify({ type: "response.cancel" });
    const result = parseClientFrame(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.type).toBe("response.cancel");
    }
  });
});

// ---------------------------------------------------------------------------
// isTerminalEvent
// ---------------------------------------------------------------------------

describe("isTerminalEvent", () => {
  test("returns true for response.completed", () => {
    expect(isTerminalEvent("response.completed")).toBe(true);
  });

  test("returns true for response.failed", () => {
    expect(isTerminalEvent("response.failed")).toBe(true);
  });

  test("returns true for response.incomplete", () => {
    expect(isTerminalEvent("response.incomplete")).toBe(true);
  });

  test("returns false for non-terminal events", () => {
    expect(isTerminalEvent("response.created")).toBe(false);
    expect(isTerminalEvent("response.output_text.delta")).toBe(false);
    expect(isTerminalEvent("error")).toBe(false);
    expect(isTerminalEvent("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseTerminalEvent
// ---------------------------------------------------------------------------

describe("parseTerminalEvent", () => {
  test("extracts usage from response.completed", () => {
    const data = {
      type: "response.completed",
      response: {
        id: "resp_123",
        status: "completed",
        model: "gpt-4o",
        usage: {
          input_tokens: 200,
          output_tokens: 100,
          total_tokens: 300,
          output_tokens_details: { reasoning_tokens: 50 },
        },
      },
    };

    const result = parseTerminalEvent(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.response.usage?.input_tokens).toBe(200);
      expect(result.data.response.usage?.output_tokens).toBe(100);
      expect(result.data.response.usage?.output_tokens_details?.reasoning_tokens).toBe(50);
    }
  });

  test("extracts status from response.failed", () => {
    const data = {
      type: "response.failed",
      response: { id: "resp_456", status: "failed" },
    };

    const result = parseTerminalEvent(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.response.status).toBe("failed");
    }
  });

  test("returns ok:false for invalid terminal event", () => {
    const result = parseTerminalEvent({ type: "response.completed" });
    expect(result.ok).toBe(false);
  });

  test("preserves prompt_cache_key in terminal response", () => {
    const data = {
      type: "response.completed",
      response: {
        id: "resp_789",
        status: "completed",
        prompt_cache_key: "cache_key_abc",
      },
    };

    const result = parseTerminalEvent(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.response.prompt_cache_key).toBe("cache_key_abc");
    }
  });
});

// ---------------------------------------------------------------------------
// parseServerError
// ---------------------------------------------------------------------------

describe("parseServerError", () => {
  test("extracts error details", () => {
    const data = {
      type: "error",
      error: {
        type: "invalid_request_error",
        code: "invalid_model",
        message: "Model not found",
        param: "model",
        event_id: "evt_abc",
      },
    };

    const result = parseServerError(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.error.type).toBe("invalid_request_error");
      expect(result.data.error.code).toBe("invalid_model");
      expect(result.data.error.message).toBe("Model not found");
      expect(result.data.error.param).toBe("model");
      expect(result.data.error.event_id).toBe("evt_abc");
    }
  });

  test("accepts minimal error with only type and message", () => {
    const data = {
      type: "error",
      error: { type: "server_error", message: "Something went wrong" },
    };

    const result = parseServerError(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.error.message).toBe("Something went wrong");
    }
  });

  test("returns ok:false for missing error object", () => {
    const result = parseServerError({ type: "error" });
    expect(result.ok).toBe(false);
  });
});
