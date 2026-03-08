import { describe, expect, it } from "vitest";
import type { ResponseUsage } from "@/lib/ws/frames";
import type { ModelPriceData } from "@/types/model-price";
import { REDACTED_MARKER } from "@/lib/utils/message-redaction";
import {
  buildWsTraceMetadata,
  redactWsEventPayload,
  settleWsTurnBilling,
  wsUsageToMetrics,
} from "@/app/v1/_lib/ws/billing-parity";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePriceData(overrides: Partial<ModelPriceData> = {}): ModelPriceData {
  return {
    input_cost_per_token: 0.000003, // $3/MTok
    output_cost_per_token: 0.000015, // $15/MTok
    cache_creation_input_token_cost: 0.00000375, // 1.25x input
    cache_read_input_token_cost: 0.0000003, // 0.1x input
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// settleWsTurnBilling
// ---------------------------------------------------------------------------

describe("settleWsTurnBilling", () => {
  it("extracts correct token counts from usage", () => {
    const result = settleWsTurnBilling({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      },
    });

    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.usageMetrics).not.toBeNull();
    expect(result.usageMetrics!.input_tokens).toBe(100);
    expect(result.usageMetrics!.output_tokens).toBe(50);
  });

  it("uses actual service_tier from terminal for pricing (not requested)", () => {
    // Scenario: client requested "priority" but terminal says "default"
    const resultDefaultActual = settleWsTurnBilling({
      usage: { input_tokens: 1000, output_tokens: 500 },
      serviceTier: "default",
      requestedServiceTier: "priority",
    });
    expect(resultDefaultActual.priorityServiceTierApplied).toBe(false);

    // Reverse: actual is priority, requested is default
    const resultPriorityActual = settleWsTurnBilling({
      usage: { input_tokens: 1000, output_tokens: 500 },
      serviceTier: "priority",
      requestedServiceTier: "default",
    });
    expect(resultPriorityActual.priorityServiceTierApplied).toBe(true);

    // With priority pricing, cost should differ when price data has priority fields
    const priceData = makePriceData({
      input_cost_per_token_priority: 0.000006, // 2x base
      output_cost_per_token_priority: 0.00006, // 4x base
    });
    const costDefault = settleWsTurnBilling({
      usage: { input_tokens: 1000, output_tokens: 500 },
      serviceTier: "default",
      priceData,
    });
    const costPriority = settleWsTurnBilling({
      usage: { input_tokens: 1000, output_tokens: 500 },
      serviceTier: "priority",
      priceData,
    });
    // Priority pricing should produce a higher cost
    expect(Number(costPriority.costUsd)).toBeGreaterThan(Number(costDefault.costUsd));
  });

  it("handles missing/null usage gracefully", () => {
    const result = settleWsTurnBilling({
      usage: undefined,
      model: "gpt-4o",
      priceData: makePriceData(),
    });

    expect(result.usageMetrics).toBeNull();
    expect(result.inputTokens).toBeUndefined();
    expect(result.outputTokens).toBeUndefined();
    expect(result.costUsd).toBeUndefined();
    expect(result.costBreakdown).toBeUndefined();
    expect(result.priorityServiceTierApplied).toBe(false);
  });

  it("handles response.failed with partial usage", () => {
    const result = settleWsTurnBilling({
      usage: {
        input_tokens: 500,
        output_tokens: 0,
      },
      priceData: makePriceData(),
    });

    expect(result.inputTokens).toBe(500);
    expect(result.outputTokens).toBe(0);
    expect(result.usageMetrics).not.toBeNull();
    // Cost is still computed from partial usage
    expect(result.costBreakdown).toBeDefined();
    expect(result.costBreakdown!.input).toBeCloseTo(0.0015, 6); // 500 * 0.000003
    expect(result.costBreakdown!.output).toBe(0);
    expect(result.costBreakdown!.total).toBeCloseTo(0.0015, 6);
  });

  it("extracts cache tokens from passthrough usage fields", () => {
    // WS usage schema uses .passthrough() so cache fields may be present
    const usage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 300,
    } as ResponseUsage;

    const result = settleWsTurnBilling({ usage });
    expect(result.cacheCreationInputTokens).toBe(200);
    expect(result.cacheReadInputTokens).toBe(300);
  });

  it("falls back to requested tier when actual tier is absent", () => {
    const result = settleWsTurnBilling({
      usage: { input_tokens: 100, output_tokens: 50 },
      serviceTier: undefined,
      requestedServiceTier: "priority",
    });
    expect(result.priorityServiceTierApplied).toBe(true);
  });

  it("skips cost calculation when priceData is absent", () => {
    const result = settleWsTurnBilling({
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    expect(result.costUsd).toBeUndefined();
    expect(result.costBreakdown).toBeUndefined();
    // Token counts should still be populated
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// buildWsTraceMetadata
// ---------------------------------------------------------------------------

describe("buildWsTraceMetadata", () => {
  it("includes transport metadata", () => {
    const metadata = buildWsTraceMetadata({
      handshakeMs: 45,
      eventCount: 12,
      terminalType: "response.completed",
      model: "gpt-4o",
      serviceTier: "default",
      durationMs: 3500,
      statusCode: 200,
    });

    expect(metadata.transport).toBe("websocket");
    expect(metadata.handshakeMs).toBe(45);
    expect(metadata.eventCount).toBe(12);
    expect(metadata.durationMs).toBe(3500);
    expect(metadata.statusCode).toBe(200);
  });

  it("includes terminal event type and model", () => {
    const metadata = buildWsTraceMetadata({
      eventCount: 5,
      terminalType: "response.failed",
      model: "gpt-4o-mini",
      serviceTier: "priority",
      durationMs: 1200,
      errorMessage: "Rate limit exceeded",
    });

    expect(metadata.terminalType).toBe("response.failed");
    expect(metadata.model).toBe("gpt-4o-mini");
    expect(metadata.serviceTier).toBe("priority");
    expect(metadata.errorMessage).toBe("Rate limit exceeded");
  });
});

// ---------------------------------------------------------------------------
// redactWsEventPayload
// ---------------------------------------------------------------------------

describe("redactWsEventPayload", () => {
  it("redacts reasoning.summary content", () => {
    const event = {
      type: "response.output_item.done",
      item: {
        type: "reasoning",
        id: "rs_001",
        summary: [{ type: "summary_text", text: "The user is asking about sensitive data..." }],
      },
    };

    const redacted = redactWsEventPayload(event);
    const item = redacted.item as Record<string, unknown>;
    const summary = item.summary as Array<Record<string, unknown>>;

    expect(summary[0].text).toBe(REDACTED_MARKER);
    expect(summary[0].type).toBe("summary_text"); // type preserved
  });

  it("redacts reasoning.encrypted_content", () => {
    const event = {
      type: "response.output_item.done",
      item: {
        type: "reasoning",
        id: "rs_002",
        encrypted_content: "base64-encoded-encrypted-reasoning-data",
        summary: [],
      },
    };

    const redacted = redactWsEventPayload(event);
    const item = redacted.item as Record<string, unknown>;
    expect(item.encrypted_content).toBe(REDACTED_MARKER);
  });

  it("redacts tool call arguments", () => {
    const event = {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        id: "fc_001",
        name: "get_weather",
        call_id: "call_abc",
        arguments: '{"location": "San Francisco", "api_key": "secret123"}',
      },
    };

    const redacted = redactWsEventPayload(event);
    const item = redacted.item as Record<string, unknown>;

    expect(item.arguments).toBe(REDACTED_MARKER);
    expect(item.name).toBe("get_weather"); // metadata preserved
    expect(item.call_id).toBe("call_abc"); // metadata preserved
    expect(item.id).toBe("fc_001"); // id preserved
  });

  it("preserves non-sensitive event data", () => {
    const event = {
      type: "response.created",
      response: {
        id: "resp_001",
        object: "response",
        status: "in_progress",
        model: "gpt-4o",
        service_tier: "default",
      },
    };

    const redacted = redactWsEventPayload(event);
    expect(redacted.type).toBe("response.created");
    const response = redacted.response as Record<string, unknown>;
    expect(response.id).toBe("resp_001");
    expect(response.model).toBe("gpt-4o");
    expect(response.status).toBe("in_progress");
    expect(response.service_tier).toBe("default");
  });

  it("redacts terminal event response.output[] items", () => {
    const event = {
      type: "response.completed",
      response: {
        id: "resp_001",
        status: "completed",
        model: "gpt-4o",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Secret answer here" }],
          },
          {
            type: "reasoning",
            summary: [{ type: "summary_text", text: "Internal reasoning" }],
            encrypted_content: "enc-data",
          },
          {
            type: "function_call",
            name: "search",
            arguments: '{"query": "sensitive"}',
          },
        ],
      },
    };

    const redacted = redactWsEventPayload(event);
    const response = redacted.response as Record<string, unknown>;
    const output = response.output as Array<Record<string, unknown>>;

    // Message content redacted
    const msg = output[0];
    const content = msg.content as Array<Record<string, unknown>>;
    expect(content[0].text).toBe(REDACTED_MARKER);

    // Reasoning summary + encrypted_content redacted
    const reasoning = output[1];
    const summary = reasoning.summary as Array<Record<string, unknown>>;
    expect(summary[0].text).toBe(REDACTED_MARKER);
    expect(reasoning.encrypted_content).toBe(REDACTED_MARKER);

    // Function call arguments redacted
    const funcCall = output[2];
    expect(funcCall.arguments).toBe(REDACTED_MARKER);
    expect(funcCall.name).toBe("search"); // metadata preserved
  });

  it("redacts delta events for sensitive content types", () => {
    const textDelta = {
      type: "response.output_text.delta",
      delta: "Hello, world!",
      output_index: 0,
    };
    const redactedText = redactWsEventPayload(textDelta);
    expect(redactedText.delta).toBe(REDACTED_MARKER);
    expect(redactedText.output_index).toBe(0); // preserved

    const reasoningDelta = {
      type: "response.reasoning_summary_text.delta",
      delta: "thinking about...",
    };
    expect(redactWsEventPayload(reasoningDelta).delta).toBe(REDACTED_MARKER);

    const funcArgsDelta = {
      type: "response.function_call_arguments.delta",
      delta: '{"arg":',
    };
    expect(redactWsEventPayload(funcArgsDelta).delta).toBe(REDACTED_MARKER);
  });

  it("preserves non-sensitive delta events", () => {
    const audioDelta = {
      type: "response.audio.delta",
      delta: "base64audiodata",
    };
    expect(redactWsEventPayload(audioDelta).delta).toBe("base64audiodata");
  });

  it("does not mutate the original event object", () => {
    const original = {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        name: "test",
        arguments: '{"secret": true}',
      },
    };

    const originalArgs = (original.item as Record<string, unknown>).arguments;
    redactWsEventPayload(original);
    expect((original.item as Record<string, unknown>).arguments).toBe(originalArgs);
  });
});

// ---------------------------------------------------------------------------
// wsUsageToMetrics
// ---------------------------------------------------------------------------

describe("wsUsageToMetrics", () => {
  it("returns null for undefined usage", () => {
    expect(wsUsageToMetrics(undefined)).toBeNull();
  });

  it("maps basic token counts", () => {
    const metrics = wsUsageToMetrics({
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    });

    expect(metrics).not.toBeNull();
    expect(metrics!.input_tokens).toBe(100);
    expect(metrics!.output_tokens).toBe(50);
  });

  it("extracts cache fields from passthrough", () => {
    const usage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 300,
    } as ResponseUsage;

    const metrics = wsUsageToMetrics(usage);
    expect(metrics!.cache_creation_input_tokens).toBe(200);
    expect(metrics!.cache_read_input_tokens).toBe(300);
  });

  it("leaves cache fields undefined when not present", () => {
    const metrics = wsUsageToMetrics({
      input_tokens: 100,
      output_tokens: 50,
    });

    expect(metrics!.cache_creation_input_tokens).toBeUndefined();
    expect(metrics!.cache_read_input_tokens).toBeUndefined();
  });
});
