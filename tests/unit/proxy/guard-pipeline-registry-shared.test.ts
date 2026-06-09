/**
 * Regression (group-rate-limit): the guard-extension registry must survive being
 * read from a *different module instance* than the one it was registered in.
 *
 * In the Next.js standalone build, `instrumentation.ts` is bundled separately from
 * the proxy route handlers, so each gets its own copy of `guard-pipeline.ts`. A
 * plain module-local `extensions` array would be populated in the instrumentation
 * copy and read as empty by the request path — the spliced `modelRateLimit` guard
 * would never run. The registry is therefore backed by a `globalThis` singleton.
 *
 * `vi.resetModules()` forces a fresh module evaluation on the next import, which
 * faithfully reproduces the "two copies of the module" condition in a single
 * vitest process.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GLOBAL_KEY = "__CCH_GUARD_EXTENSION_STEPS__";

function clearGlobalRegistry(): void {
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
}

describe("guard-pipeline extension registry (cross module-instance)", () => {
  beforeEach(() => {
    clearGlobalRegistry();
    vi.resetModules();
  });

  afterEach(() => {
    clearGlobalRegistry();
    vi.resetModules();
  });

  it("a step registered in one module instance is visible to a freshly re-imported instance", async () => {
    // Instance A — stands in for the instrumentation realm that performs registration.
    const modA = await import("@/app/v1/_lib/proxy/guard-pipeline");
    const sentinel = new Response(null, { status: 418 });
    modA.registerExtensionStep({
      key: "__test_marker__",
      step: { name: "__test_marker__", execute: async () => sentinel },
      insertBefore: "rateLimit",
    });

    // Force a brand-new module instance — its module-local `const extensions = []`
    // re-runs, so only a globalThis-backed registry can carry the registration over.
    vi.resetModules();
    const modB = await import("@/app/v1/_lib/proxy/guard-pipeline");

    // The pipeline built from instance B must splice the step registered in A in
    // front of `rateLimit`; the sentinel short-circuits the run before the real
    // rateLimit guard executes, so no live session is required.
    const pipeline = modB.GuardPipelineBuilder.build({ steps: ["rateLimit"] });
    const result = await pipeline.run({} as never);

    expect(result).toBe(sentinel);
  });

  it("isolates the registry per globalThis: a cleared registry does not leak the step", async () => {
    const modA = await import("@/app/v1/_lib/proxy/guard-pipeline");
    modA.registerExtensionStep({
      key: "__test_marker__",
      step: { name: "__test_marker__", execute: async () => new Response(null, { status: 418 }) },
      insertBefore: "rateLimit",
    });
    modA.__clearExtensionSteps();

    vi.resetModules();
    const modB = await import("@/app/v1/_lib/proxy/guard-pipeline");
    const pipeline = modB.GuardPipelineBuilder.build({ steps: ["probe"] });

    // No anchor for the (now cleared) extension, and a probe-only chain returns null.
    const result = await pipeline.run({ isProbeRequest: () => false } as never);
    expect(result).toBeNull();
  });
});
