import { describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types/provider";
import type { SchedulingSimulationInput } from "@/lib/scheduling-simulator";

// Mock circuit breaker
vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitState: vi.fn(() => "closed" as const),
  isCircuitOpen: vi.fn(() => Promise.resolve(false)),
  getAllHealthStatusAsync: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/vendor-type-circuit-breaker", () => ({
  isVendorTypeCircuitOpen: vi.fn(() => Promise.resolve(false)),
}));

function createProvider(overrides: Partial<Provider> & { id: number; name: string }): Provider {
  return {
    providerType: "claude",
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupTag: null,
    groupPriorities: null,
    allowedModels: null,
    modelRedirects: null,
    activeTimeStart: null,
    activeTimeEnd: null,
    allowedClients: [],
    blockedClients: [],
    costMultiplier: 1,
    ...overrides,
  } as unknown as Provider;
}

describe("scheduling simulator", () => {
  it("returns empty result for empty providers", async () => {
    const { simulateProviderScheduling } = await import("@/lib/scheduling-simulator");
    const input: SchedulingSimulationInput = {
      format: "claude",
      model: "claude-opus-4-5",
      groups: [],
    };
    const result = await simulateProviderScheduling(input, []);
    expect(result.steps.length).toBe(5);
    expect(result.summary.total).toBe(0);
    expect(result.summary.final).toBe(0);
  });

  it("single provider passes all filters with 100% probability", async () => {
    const { simulateProviderScheduling } = await import("@/lib/scheduling-simulator");
    const providers = [createProvider({ id: 1, name: "Provider A" })];
    const input: SchedulingSimulationInput = {
      format: "claude",
      model: "claude-opus-4-5",
      groups: [],
    };
    const result = await simulateProviderScheduling(input, providers);
    expect(result.summary.final).toBe(1);
    expect(result.priorityLevels).toHaveLength(1);
    expect(result.priorityLevels[0].providers[0].probability).toBeCloseTo(1.0);
  });

  it("filters disabled providers", async () => {
    const { simulateProviderScheduling } = await import("@/lib/scheduling-simulator");
    const providers = [
      createProvider({ id: 1, name: "Enabled", isEnabled: true }),
      createProvider({ id: 2, name: "Disabled", isEnabled: false }),
    ];
    const input: SchedulingSimulationInput = {
      format: "claude",
      model: "test",
      groups: [],
    };
    const result = await simulateProviderScheduling(input, providers);
    expect(result.summary.afterBasic).toBe(1);
    const basicStep = result.steps.find((s) => s.name === "basic_filter");
    expect(basicStep?.failed.some((f) => f.name === "Disabled")).toBe(true);
  });

  it("filters by format compatibility", async () => {
    const { simulateProviderScheduling } = await import("@/lib/scheduling-simulator");
    const providers = [
      createProvider({ id: 1, name: "Claude Provider", providerType: "claude" }),
      createProvider({ id: 2, name: "OpenAI Provider", providerType: "openai-compatible" }),
    ];
    const input: SchedulingSimulationInput = {
      format: "claude",
      model: "test",
      groups: [],
    };
    const result = await simulateProviderScheduling(input, providers);
    expect(result.summary.afterBasic).toBe(1);
    const basicStep = result.steps.find((s) => s.name === "basic_filter");
    expect(basicStep?.failed.some((f) => f.reason === "format_type_mismatch")).toBe(true);
  });

  it("filters by model whitelist with advanced matching", async () => {
    const { simulateProviderScheduling } = await import("@/lib/scheduling-simulator");
    const providers = [
      createProvider({
        id: 1,
        name: "Allows Opus",
        allowedModels: [{ matchType: "prefix", pattern: "claude-opus" }],
      }),
      createProvider({
        id: 2,
        name: "Allows Sonnet Only",
        allowedModels: [{ matchType: "exact", pattern: "claude-sonnet-4-5" }],
      }),
    ];
    const input: SchedulingSimulationInput = {
      format: "claude",
      model: "claude-opus-4-5",
      groups: [],
    };
    const result = await simulateProviderScheduling(input, providers);
    expect(result.summary.afterBasic).toBe(1);
    const basicStep = result.steps.find((s) => s.name === "basic_filter");
    expect(basicStep?.passed.some((p) => p.name === "Allows Opus")).toBe(true);
    expect(basicStep?.failed.some((f) => f.name === "Allows Sonnet Only")).toBe(true);
  });

  it("filters by group when groups specified", async () => {
    const { simulateProviderScheduling } = await import("@/lib/scheduling-simulator");
    const providers = [
      createProvider({ id: 1, name: "Group A", groupTag: "groupA" }),
      createProvider({ id: 2, name: "Group B", groupTag: "groupB" }),
      createProvider({ id: 3, name: "No Group", groupTag: null }),
    ];
    const input: SchedulingSimulationInput = {
      format: "claude",
      model: "test",
      groups: ["groupA"],
    };
    const result = await simulateProviderScheduling(input, providers);
    expect(result.summary.afterGroup).toBe(1);
  });

  it("skips group filter when no groups specified", async () => {
    const { simulateProviderScheduling } = await import("@/lib/scheduling-simulator");
    const providers = [
      createProvider({ id: 1, name: "Group A", groupTag: "groupA" }),
      createProvider({ id: 2, name: "No Group", groupTag: null }),
    ];
    const input: SchedulingSimulationInput = {
      format: "claude",
      model: "test",
      groups: [],
    };
    const result = await simulateProviderScheduling(input, providers);
    expect(result.summary.afterGroup).toBe(2);
  });

  it("correctly splits multi-priority tiers", async () => {
    const { simulateProviderScheduling } = await import("@/lib/scheduling-simulator");
    const providers = [
      createProvider({ id: 1, name: "Priority 0", priority: 0 }),
      createProvider({ id: 2, name: "Priority 1", priority: 1 }),
      createProvider({ id: 3, name: "Priority 1 Also", priority: 1 }),
    ];
    const input: SchedulingSimulationInput = {
      format: "claude",
      model: "test",
      groups: [],
    };
    const result = await simulateProviderScheduling(input, providers);
    expect(result.priorityLevels).toHaveLength(2);
    expect(result.priorityLevels[0].priority).toBe(0);
    expect(result.priorityLevels[0].providers).toHaveLength(1);
    expect(result.priorityLevels[1].priority).toBe(1);
    expect(result.priorityLevels[1].providers).toHaveLength(2);
  });

  it("calculates weight distribution correctly", async () => {
    const { simulateProviderScheduling } = await import("@/lib/scheduling-simulator");
    const providers = [
      createProvider({ id: 1, name: "Weight 1", weight: 1, priority: 0 }),
      createProvider({ id: 2, name: "Weight 3", weight: 3, priority: 0 }),
    ];
    const input: SchedulingSimulationInput = {
      format: "claude",
      model: "test",
      groups: [],
    };
    const result = await simulateProviderScheduling(input, providers);
    const topTier = result.priorityLevels[0];
    expect(topTier.providers).toHaveLength(2);

    const w1 = topTier.providers.find((p) => p.name === "Weight 1");
    const w3 = topTier.providers.find((p) => p.name === "Weight 3");
    expect(w1?.probability).toBeCloseTo(0.25);
    expect(w3?.probability).toBeCloseTo(0.75);
  });

  it("populates model redirect info for surviving providers", async () => {
    const { simulateProviderScheduling } = await import("@/lib/scheduling-simulator");
    const providers = [
      createProvider({
        id: 1,
        name: "With Redirect",
        modelRedirects: [{ matchType: "exact", source: "claude-opus-4-5", target: "glm-4.6" }],
      }),
      createProvider({ id: 2, name: "No Redirect" }),
    ];
    const input: SchedulingSimulationInput = {
      format: "claude",
      model: "claude-opus-4-5",
      groups: [],
    };
    const result = await simulateProviderScheduling(input, providers);
    const topTier = result.priorityLevels[0];
    const withRedirect = topTier.providers.find((p) => p.name === "With Redirect");
    const noRedirect = topTier.providers.find((p) => p.name === "No Redirect");
    expect(withRedirect?.redirectedModel).toBe("glm-4.6");
    expect(noRedirect?.redirectedModel).toBeNull();
  });

  it("filters by circuit breaker state", async () => {
    const circuitBreaker = await import("@/lib/circuit-breaker");
    vi.mocked(circuitBreaker.isCircuitOpen).mockImplementation(async (id: number) => id === 2);
    vi.mocked(circuitBreaker.getCircuitState).mockImplementation((id: number) =>
      id === 2 ? "open" : "closed"
    );

    const { simulateProviderScheduling } = await import("@/lib/scheduling-simulator");
    const providers = [
      createProvider({ id: 1, name: "Healthy" }),
      createProvider({ id: 2, name: "Breaker Open" }),
    ];
    const input: SchedulingSimulationInput = {
      format: "claude",
      model: "test",
      groups: [],
    };
    const result = await simulateProviderScheduling(input, providers);
    expect(result.summary.afterHealth).toBe(1);
    const healthStep = result.steps.find((s) => s.name === "health_filter");
    expect(healthStep?.failed.some((f) => f.name === "Breaker Open")).toBe(true);

    // Reset mocks
    vi.mocked(circuitBreaker.isCircuitOpen).mockResolvedValue(false);
    vi.mocked(circuitBreaker.getCircuitState).mockReturnValue("closed");
  });
});
