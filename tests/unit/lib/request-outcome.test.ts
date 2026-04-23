import { describe, expect, it } from "vitest";
import { classifyRequestOutcomeSignal } from "@/lib/request-outcome";

describe("request outcome taxonomy", () => {
  it("treats informational selection events as neutral", () => {
    expect(
      classifyRequestOutcomeSignal({
        reason: "initial_selection",
      })
    ).toBeNull();
  });

  it("marks client aborts as excluded", () => {
    expect(
      classifyRequestOutcomeSignal({
        reason: "client_abort",
        statusCode: 499,
      })
    ).toMatchObject({
      outcome: "excluded",
      exclusionFamily: "client_abort",
    });
  });

  it("marks matched rules as excluded", () => {
    expect(
      classifyRequestOutcomeSignal({
        statusCode: 400,
        matchedRule: {
          ruleId: 1,
          pattern: "blocked",
          matchType: "contains",
          category: "content_filter",
          hasOverrideResponse: false,
          hasOverrideStatusCode: false,
        },
      })
    ).toMatchObject({
      outcome: "excluded",
      exclusionFamily: "matched_rule",
    });
  });

  it("marks quota and routing failures as excluded", () => {
    expect(
      classifyRequestOutcomeSignal({
        errorMessage: "No available provider for this request",
      })
    ).toMatchObject({
      outcome: "excluded",
      exclusionFamily: "no_available_provider",
    });

    expect(
      classifyRequestOutcomeSignal({
        errorMessage: "quota exceeded on upstream account",
      })
    ).toMatchObject({
      outcome: "excluded",
      exclusionFamily: "quota_or_rate_limit",
    });
  });

  it("classifies upstream success and failure", () => {
    expect(
      classifyRequestOutcomeSignal({
        reason: "request_success",
        statusCode: 200,
      })
    ).toMatchObject({
      outcome: "success",
    });

    expect(
      classifyRequestOutcomeSignal({
        reason: "retry_failed",
        statusCode: 500,
        errorMessage: "upstream failed",
      })
    ).toMatchObject({
      outcome: "failure",
    });
  });
});
