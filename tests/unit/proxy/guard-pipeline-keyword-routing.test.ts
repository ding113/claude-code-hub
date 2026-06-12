import { describe, expect, it } from "vitest";

import {
  CHAT_PIPELINE,
  RAW_PASSTHROUGH_PIPELINE,
  RAW_SAFE_SESSION_PIPELINE,
} from "@/app/v1/_lib/proxy/guard-pipeline";

describe("guard pipeline keyword routing registration", () => {
  it("places keywordRouting immediately after requestFilter and before rateLimit in CHAT_PIPELINE", () => {
    const steps = CHAT_PIPELINE.steps;
    const keywordRoutingIndex = steps.indexOf("keywordRouting");
    const requestFilterIndex = steps.indexOf("requestFilter");
    const rateLimitIndex = steps.indexOf("rateLimit");

    expect(keywordRoutingIndex).toBeGreaterThan(-1);
    // 紧跟在 requestFilter 之后
    expect(keywordRoutingIndex).toBe(requestFilterIndex + 1);
    // 位于 rateLimit（进而位于 provider 选择）之前
    expect(keywordRoutingIndex).toBeLessThan(rateLimitIndex);
  });

  it("does not include keywordRouting in RAW_PASSTHROUGH_PIPELINE", () => {
    expect(RAW_PASSTHROUGH_PIPELINE.steps).not.toContain("keywordRouting");
  });

  it("does not include keywordRouting in RAW_SAFE_SESSION_PIPELINE", () => {
    expect(RAW_SAFE_SESSION_PIPELINE.steps).not.toContain("keywordRouting");
  });
});
