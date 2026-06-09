import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearExtensionSteps,
  type GuardStep,
  GuardPipelineBuilder,
  registerExtensionStep,
} from "@/app/v1/_lib/proxy/guard-pipeline";
import { ProxyRateLimitGuard } from "@/app/v1/_lib/proxy/rate-limit-guard";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

function recordingStep(name: string, calls: string[]): GuardStep {
  return {
    name,
    async execute() {
      calls.push(name);
      return null;
    },
  };
}

function fakeSession(): ProxySession {
  return {} as unknown as ProxySession;
}

describe("guard-pipeline extension hook", () => {
  beforeEach(() => __clearExtensionSteps());
  afterEach(() => {
    __clearExtensionSteps();
    vi.restoreAllMocks();
  });

  it("runs the built-in chain unchanged when no extension is registered", async () => {
    const pipeline = GuardPipelineBuilder.build({ steps: ["rateLimit"] });
    const result = await pipeline.run(fakeSession());
    expect(result).toBeNull();
  });

  it("injects an extension step immediately after its anchor", async () => {
    const calls: string[] = [];
    vi.spyOn(ProxyRateLimitGuard, "ensure").mockImplementation(async () => {
      calls.push("rateLimit");
    });
    registerExtensionStep({
      key: "modelRateLimit",
      step: recordingStep("modelRateLimit", calls),
      insertAfter: "rateLimit",
    });

    const pipeline = GuardPipelineBuilder.build({ steps: ["rateLimit"] });
    await pipeline.run(fakeSession());

    expect(calls).toEqual(["rateLimit", "modelRateLimit"]);
  });

  it("injects an extension step immediately before its anchor (insertBefore)", async () => {
    const calls: string[] = [];
    vi.spyOn(ProxyRateLimitGuard, "ensure").mockImplementation(async () => {
      calls.push("rateLimit");
    });
    registerExtensionStep({
      key: "modelRateLimit",
      step: recordingStep("modelRateLimit", calls),
      insertBefore: "rateLimit",
    });

    const pipeline = GuardPipelineBuilder.build({ steps: ["rateLimit"] });
    await pipeline.run(fakeSession());

    expect(calls).toEqual(["modelRateLimit", "rateLimit"]);
  });

  it("is idempotent: registering the same key twice keeps a single step", async () => {
    const calls: string[] = [];
    registerExtensionStep({
      key: "modelRateLimit",
      step: recordingStep("modelRateLimit", calls),
      insertAfter: "rateLimit",
    });
    registerExtensionStep({
      key: "modelRateLimit",
      step: recordingStep("modelRateLimit", calls),
      insertAfter: "rateLimit",
    });

    const pipeline = GuardPipelineBuilder.build({ steps: ["rateLimit"] });
    await pipeline.run(fakeSession());

    expect(calls.filter((c) => c === "modelRateLimit")).toHaveLength(1);
  });

  it("skips the extension when its anchor is absent from the preset", async () => {
    const calls: string[] = [];
    registerExtensionStep({
      key: "modelRateLimit",
      step: recordingStep("modelRateLimit", calls),
      insertAfter: "messageContext",
    });

    const pipeline = GuardPipelineBuilder.build({ steps: ["rateLimit"] });
    await pipeline.run(fakeSession());

    expect(calls).not.toContain("modelRateLimit");
  });
});
