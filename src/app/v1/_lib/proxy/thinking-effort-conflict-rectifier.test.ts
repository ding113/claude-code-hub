import { describe, expect, test } from "vitest";
import {
  detectThinkingEffortConflictRectifierTrigger,
  rectifyThinkingEffortConflict,
} from "./thinking-effort-conflict-rectifier";

describe("detectThinkingEffortConflictRectifierTrigger", () => {
  test("matches the documented DeepSeek conflict error", () => {
    expect(
      detectThinkingEffortConflictRectifierTrigger(
        "thinking options type cannot be disabled when reasoning_effort is set"
      )
    ).toBe("thinking_disabled_with_reasoning_effort");
  });

  test("matches the error embedded in a proxy upstream envelope", () => {
    expect(
      detectThinkingEffortConflictRectifierTrigger(
        'Provider deepseek returned 400: Provider returned 400: Bad Request | Upstream: {"error":{"message":"thinking options type cannot be disabled when reasoning_effort is set","type":"invalid_request_error","param":null,"code":"invalid_request_error"}}'
      )
    ).toBe("thinking_disabled_with_reasoning_effort");
  });

  test("matches case and quoting variants", () => {
    expect(
      detectThinkingEffortConflictRectifierTrigger(
        "Thinking options `type` cannot be disabled when `reasoning_effort` is set."
      )
    ).toBe("thinking_disabled_with_reasoning_effort");
  });

  test("matches output_config flavored variants", () => {
    expect(
      detectThinkingEffortConflictRectifierTrigger(
        "thinking cannot be disabled when output_config.effort is set"
      )
    ).toBe("thinking_disabled_with_reasoning_effort");
  });

  test("ignores unrelated errors", () => {
    expect(detectThinkingEffortConflictRectifierTrigger(null)).toBeNull();
    expect(detectThinkingEffortConflictRectifierTrigger(undefined)).toBeNull();
    expect(detectThinkingEffortConflictRectifierTrigger("")).toBeNull();
    expect(
      detectThinkingEffortConflictRectifierTrigger("Invalid `signature` in `thinking` block")
    ).toBeNull();
    expect(
      detectThinkingEffortConflictRectifierTrigger(
        "thinking.enabled.budget_tokens: Input should be greater than or equal to 1024"
      )
    ).toBeNull();
    expect(
      detectThinkingEffortConflictRectifierTrigger("reasoning_effort must be one of low|medium")
    ).toBeNull();
    expect(detectThinkingEffortConflictRectifierTrigger("invalid request: malformed")).toBeNull();
  });
});

describe("rectifyThinkingEffortConflict", () => {
  test("removes output_config when thinking is disabled (Claude Code subagent shape)", () => {
    const message: Record<string, unknown> = {
      model: "deepseek-v4-pro",
      thinking: { type: "disabled" },
      output_config: { effort: "max" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };

    const result = rectifyThinkingEffortConflict(message);

    expect(result.applied).toBe(true);
    expect(result.removedOutputConfigEffort).toBe(true);
    expect(result.removedReasoningEffort).toBe(false);
    expect(result.thinkingType).toBe("disabled");
    expect(result.effort).toBe("max");
    expect("output_config" in message).toBe(false);
    expect(message.thinking).toEqual({ type: "disabled" });
  });

  test("strips only effort and preserves sibling keys in output_config", () => {
    const message: Record<string, unknown> = {
      thinking: { type: "disabled" },
      output_config: { effort: "max", verbosity: "high", future_flag: true },
      messages: [],
    };

    const result = rectifyThinkingEffortConflict(message);

    expect(result.applied).toBe(true);
    expect(result.removedOutputConfigEffort).toBe(true);
    expect(result.effort).toBe("max");
    // Sibling fields must survive; only the conflicting effort carrier is removed.
    expect(message.output_config).toEqual({ verbosity: "high", future_flag: true });
  });

  test("drops output_config entirely when effort was its only key", () => {
    const message: Record<string, unknown> = {
      thinking: { type: "disabled" },
      output_config: { effort: "max" },
      messages: [],
    };

    rectifyThinkingEffortConflict(message);

    expect("output_config" in message).toBe(false);
  });

  test("removes a top-level reasoning_effort passthrough as well", () => {
    const message: Record<string, unknown> = {
      thinking: { type: "disabled" },
      reasoning_effort: "high",
      messages: [],
    };

    const result = rectifyThinkingEffortConflict(message);

    expect(result.applied).toBe(true);
    expect(result.removedOutputConfigEffort).toBe(false);
    expect(result.removedReasoningEffort).toBe(true);
    expect(result.effort).toBe("high");
    expect("reasoning_effort" in message).toBe(false);
  });

  test("treats a missing thinking field as disabled and strips effort", () => {
    const message: Record<string, unknown> = {
      output_config: { effort: "medium" },
      messages: [],
    };

    const result = rectifyThinkingEffortConflict(message);

    expect(result.applied).toBe(true);
    expect(result.removedOutputConfigEffort).toBe(true);
    expect(result.thinkingType).toBeNull();
  });

  test("does not touch requests with thinking enabled", () => {
    const message: Record<string, unknown> = {
      thinking: { type: "enabled", budget_tokens: 2048 },
      output_config: { effort: "max" },
    };

    const result = rectifyThinkingEffortConflict(message);

    expect(result.applied).toBe(false);
    expect(message.output_config).toEqual({ effort: "max" });
    expect(message.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
  });

  test("does not touch requests with adaptive thinking", () => {
    const message: Record<string, unknown> = {
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    };

    expect(rectifyThinkingEffortConflict(message).applied).toBe(false);
    expect(message.output_config).toEqual({ effort: "low" });
  });

  test("is a no-op when no effort fields are present", () => {
    const message: Record<string, unknown> = {
      thinking: { type: "disabled" },
      messages: [],
    };

    const result = rectifyThinkingEffortConflict(message);

    expect(result.applied).toBe(false);
    expect(result.removedOutputConfigEffort).toBe(false);
    expect(result.removedReasoningEffort).toBe(false);
  });

  test("keeps an effort-less output_config in place", () => {
    const message: Record<string, unknown> = {
      thinking: { type: "disabled" },
      output_config: { something_else: true },
      reasoning_effort: "low",
    };

    const result = rectifyThinkingEffortConflict(message);

    expect(result.applied).toBe(true);
    expect(result.removedOutputConfigEffort).toBe(false);
    expect(result.removedReasoningEffort).toBe(true);
    expect(message.output_config).toEqual({ something_else: true });
  });
});
