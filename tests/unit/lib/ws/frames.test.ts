import { describe, expect, test } from "vitest";
import {
  ClientFrameSchema,
  ReasoningConfigSchema,
  ResponseCreateFrameSchema,
  ServiceTierSchema,
  TerminalEventSchema,
  UsageSchema,
  ServerErrorFrameSchema,
} from "@/lib/ws/frames";

// ---------------------------------------------------------------------------
// ResponseCreateFrameSchema
// ---------------------------------------------------------------------------

describe("ResponseCreateFrameSchema", () => {
  test("accepts valid response.create with all optional fields", () => {
    const frame = {
      type: "response.create",
      response: {
        model: "gpt-4o",
        input: [{ type: "message", role: "user", content: "hello" }],
        instructions: "be concise",
        max_output_tokens: 4096,
        metadata: { session_id: "sess_abc" },
        parallel_tool_calls: true,
        previous_response_id: "resp_prev_123",
        reasoning: { effort: "high", summary: "auto" },
        store: true,
        temperature: 0.7,
        tool_choice: "auto",
        tools: [{ type: "function", function: { name: "search" } }],
        top_p: 0.9,
        truncation: "auto",
        user: "user_123",
        service_tier: "flex",
        stream: true,
        prompt_cache_key: "019b82ff-08ff-75a3-a203-7e10274fdbd8",
      },
    };

    const result = ResponseCreateFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
  });

  test("accepts minimal response.create with only model", () => {
    const frame = {
      type: "response.create",
      response: { model: "gpt-4o" },
    };

    const result = ResponseCreateFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
  });

  test("accepts service_tier:'flex'", () => {
    const frame = {
      type: "response.create",
      response: { model: "gpt-4o", service_tier: "flex" },
    };

    const result = ResponseCreateFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.response.service_tier).toBe("flex");
    }
  });

  test("accepts stream:false (non-streaming)", () => {
    const frame = {
      type: "response.create",
      response: { model: "gpt-4o", stream: false },
    };

    const result = ResponseCreateFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.response.stream).toBe(false);
    }
  });

  test("preserves reasoning.encrypted_content bytes", () => {
    const encrypted = "base64+encrypted/content==";
    const frame = {
      type: "response.create",
      response: {
        model: "gpt-4o",
        reasoning: { effort: "high", encrypted_content: encrypted },
      },
    };

    const result = ResponseCreateFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.response.reasoning?.encrypted_content).toBe(encrypted);
    }
  });

  test("accepts previous_response_id", () => {
    const frame = {
      type: "response.create",
      response: {
        model: "gpt-4o",
        previous_response_id: "resp_abc123456789",
      },
    };

    const result = ResponseCreateFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.response.previous_response_id).toBe("resp_abc123456789");
    }
  });

  test("rejects missing model", () => {
    const frame = {
      type: "response.create",
      response: {},
    };

    const result = ResponseCreateFrameSchema.safeParse(frame);
    expect(result.success).toBe(false);
  });

  test("rejects empty model string", () => {
    const frame = {
      type: "response.create",
      response: { model: "" },
    };

    const result = ResponseCreateFrameSchema.safeParse(frame);
    expect(result.success).toBe(false);
  });

  test("preserves unknown fields via passthrough on response body", () => {
    const frame = {
      type: "response.create",
      response: {
        model: "gpt-4o",
        new_future_field: "some-value",
      },
    };

    const result = ResponseCreateFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.response as Record<string, unknown>).new_future_field).toBe("some-value");
    }
  });
});

// ---------------------------------------------------------------------------
// ClientFrameSchema (discriminated union)
// ---------------------------------------------------------------------------

describe("ClientFrameSchema", () => {
  test("rejects missing type field", () => {
    const result = ClientFrameSchema.safeParse({ response: { model: "gpt-4o" } });
    expect(result.success).toBe(false);
  });

  test("rejects invalid type field", () => {
    const result = ClientFrameSchema.safeParse({
      type: "response.unknown",
      response: { model: "gpt-4o" },
    });
    expect(result.success).toBe(false);
  });

  test("accepts response.cancel", () => {
    const result = ClientFrameSchema.safeParse({ type: "response.cancel" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("response.cancel");
    }
  });
});

// ---------------------------------------------------------------------------
// ServiceTierSchema forward compatibility
// ---------------------------------------------------------------------------

describe("ServiceTierSchema", () => {
  test("accepts known tier values", () => {
    for (const tier of ["auto", "default", "flex", "priority"]) {
      expect(ServiceTierSchema.safeParse(tier).success).toBe(true);
    }
  });

  test("accepts unknown string tier for forward compat", () => {
    const result = ServiceTierSchema.safeParse("new-future-tier");
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ReasoningConfigSchema
// ---------------------------------------------------------------------------

describe("ReasoningConfigSchema", () => {
  test("preserves unknown fields via passthrough", () => {
    const config = { effort: "high", future_flag: true };
    const result = ReasoningConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).future_flag).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// UsageSchema
// ---------------------------------------------------------------------------

describe("UsageSchema", () => {
  test("accepts complete usage block", () => {
    const usage = {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      output_tokens_details: { reasoning_tokens: 20 },
    };
    const result = UsageSchema.safeParse(usage);
    expect(result.success).toBe(true);
  });

  test("accepts usage without optional fields", () => {
    const usage = { input_tokens: 100, output_tokens: 50 };
    const result = UsageSchema.safeParse(usage);
    expect(result.success).toBe(true);
  });

  test("rejects negative token counts", () => {
    const usage = { input_tokens: -1, output_tokens: 50 };
    const result = UsageSchema.safeParse(usage);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TerminalEventSchema
// ---------------------------------------------------------------------------

describe("TerminalEventSchema", () => {
  test("accepts response.completed with usage", () => {
    const event = {
      type: "response.completed",
      response: {
        id: "resp_abc123",
        status: "completed",
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    };
    const result = TerminalEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  test("accepts response.failed", () => {
    const event = {
      type: "response.failed",
      response: { id: "resp_abc123", status: "failed" },
    };
    const result = TerminalEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  test("accepts response.incomplete", () => {
    const event = {
      type: "response.incomplete",
      response: { id: "resp_abc123", status: "incomplete" },
    };
    const result = TerminalEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  test("rejects non-terminal event type", () => {
    const event = {
      type: "response.output_text.delta",
      response: { id: "resp_abc123", status: "completed" },
    };
    const result = TerminalEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ServerErrorFrameSchema
// ---------------------------------------------------------------------------

describe("ServerErrorFrameSchema", () => {
  test("accepts full error frame", () => {
    const frame = {
      type: "error",
      error: {
        type: "invalid_request_error",
        code: "invalid_model",
        message: "The model does not exist",
        param: "model",
        event_id: "evt_123",
      },
    };
    const result = ServerErrorFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
  });

  test("accepts minimal error frame", () => {
    const frame = {
      type: "error",
      error: { type: "server_error", message: "Internal error" },
    };
    const result = ServerErrorFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
  });

  test("accepts null param", () => {
    const frame = {
      type: "error",
      error: { type: "server_error", message: "err", param: null },
    };
    const result = ServerErrorFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
  });
});
