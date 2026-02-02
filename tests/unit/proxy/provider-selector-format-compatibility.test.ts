import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

const circuitBreakerMocks = vi.hoisted(() => ({
  isCircuitOpen: vi.fn(async () => false),
  getCircuitState: vi.fn(() => "closed"),
}));

vi.mock("@/lib/circuit-breaker", () => circuitBreakerMocks);

describe("ProxyProviderResolver.pickRandomProvider - format/providerType compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createSessionStub(originalFormat: string, providers: Provider[], originalModel: string) {
    return {
      originalFormat,
      authState: null,
      getProvidersSnapshot: async () => providers,
      getOriginalModel: () => originalModel,
      getCurrentModel: () => originalModel,
      clientRequestsContext1m: () => false,
    } as any;
  }

  function createProvider(
    id: number,
    providerType: string,
    overrides: Partial<Provider> = {}
  ): Provider {
    return {
      id,
      name: `provider-${id}`,
      isEnabled: true,
      providerType,
      groupTag: null,
      weight: 1,
      priority: 0,
      costMultiplier: 1,
      allowedModels: null,
      ...overrides,
    } as unknown as Provider;
  }

  async function setupResolverMocks() {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    vi.spyOn(ProxyProviderResolver as any, "filterByLimits").mockImplementation(
      async (...args: unknown[]) => args[0] as Provider[]
    );
    vi.spyOn(ProxyProviderResolver as any, "selectTopPriority").mockImplementation(
      (...args: unknown[]) => args[0] as Provider[]
    );
    vi.spyOn(ProxyProviderResolver as any, "selectOptimal").mockImplementation(
      (...args: unknown[]) => (args[0] as Provider[])[0] ?? null
    );

    return ProxyProviderResolver;
  }

  test("openai format rejects claude provider, selects openai-compatible", async () => {
    const ProxyProviderResolver = await setupResolverMocks();

    const incompatible = createProvider(1, "claude");
    const compatible = createProvider(2, "openai-compatible");
    const session = createSessionStub("openai", [incompatible, compatible], "gpt-4o");

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(2);
    expect(provider?.providerType).toBe("openai-compatible");

    const mismatch = context.filteredProviders.find(
      (fp: any) => fp.id === 1 && fp.reason === "format_type_mismatch"
    );
    expect(mismatch).toBeDefined();
    expect(mismatch.details).toContain("openai");
    expect(mismatch.details).toContain("claude");
  });

  test("openai format rejects codex provider, selects openai-compatible", async () => {
    const ProxyProviderResolver = await setupResolverMocks();

    const incompatible = createProvider(1, "codex");
    const compatible = createProvider(2, "openai-compatible");
    const session = createSessionStub("openai", [incompatible, compatible], "gpt-4o");

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(2);
    expect(provider?.providerType).toBe("openai-compatible");

    const mismatch = context.filteredProviders.find(
      (fp: any) => fp.id === 1 && fp.reason === "format_type_mismatch"
    );
    expect(mismatch).toBeDefined();
  });

  test("response format rejects openai-compatible provider, selects codex", async () => {
    const ProxyProviderResolver = await setupResolverMocks();

    const incompatible = createProvider(1, "openai-compatible");
    const compatible = createProvider(2, "codex");
    const session = createSessionStub("response", [incompatible, compatible], "codex-mini-latest");

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(2);
    expect(provider?.providerType).toBe("codex");

    const mismatch = context.filteredProviders.find(
      (fp: any) => fp.id === 1 && fp.reason === "format_type_mismatch"
    );
    expect(mismatch).toBeDefined();
    expect(mismatch.details).toContain("response");
    expect(mismatch.details).toContain("openai-compatible");
  });

  test("response format rejects claude provider, selects codex", async () => {
    const ProxyProviderResolver = await setupResolverMocks();

    const incompatible = createProvider(1, "claude");
    const compatible = createProvider(2, "codex");
    const session = createSessionStub("response", [incompatible, compatible], "codex-mini-latest");

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(2);
    expect(provider?.providerType).toBe("codex");

    const mismatch = context.filteredProviders.find(
      (fp: any) => fp.id === 1 && fp.reason === "format_type_mismatch"
    );
    expect(mismatch).toBeDefined();
  });

  test("claude format rejects openai-compatible provider, selects claude", async () => {
    const ProxyProviderResolver = await setupResolverMocks();

    const incompatible = createProvider(1, "openai-compatible");
    const compatible = createProvider(2, "claude");
    const session = createSessionStub(
      "claude",
      [incompatible, compatible],
      "claude-sonnet-4-20250514"
    );

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(2);
    expect(provider?.providerType).toBe("claude");

    const mismatch = context.filteredProviders.find(
      (fp: any) => fp.id === 1 && fp.reason === "format_type_mismatch"
    );
    expect(mismatch).toBeDefined();
    expect(mismatch.details).toContain("claude");
    expect(mismatch.details).toContain("openai-compatible");
  });

  test("claude format accepts claude-auth provider", async () => {
    const ProxyProviderResolver = await setupResolverMocks();

    const incompatible = createProvider(1, "codex");
    const compatible = createProvider(2, "claude-auth");
    const session = createSessionStub(
      "claude",
      [incompatible, compatible],
      "claude-sonnet-4-20250514"
    );

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(2);
    expect(provider?.providerType).toBe("claude-auth");

    const mismatch = context.filteredProviders.find(
      (fp: any) => fp.id === 1 && fp.reason === "format_type_mismatch"
    );
    expect(mismatch).toBeDefined();
  });

  test("gemini format rejects claude provider, selects gemini", async () => {
    const ProxyProviderResolver = await setupResolverMocks();

    const incompatible = createProvider(1, "claude");
    const compatible = createProvider(2, "gemini");
    const session = createSessionStub("gemini", [incompatible, compatible], "gemini-2.0-flash");

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(2);
    expect(provider?.providerType).toBe("gemini");

    const mismatch = context.filteredProviders.find(
      (fp: any) => fp.id === 1 && fp.reason === "format_type_mismatch"
    );
    expect(mismatch).toBeDefined();
    expect(mismatch.details).toContain("gemini");
  });

  test("gemini-cli format rejects gemini provider, selects gemini-cli", async () => {
    const ProxyProviderResolver = await setupResolverMocks();

    const incompatible = createProvider(1, "gemini");
    const compatible = createProvider(2, "gemini-cli");
    const session = createSessionStub("gemini-cli", [incompatible, compatible], "gemini-2.0-flash");

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(2);
    expect(provider?.providerType).toBe("gemini-cli");

    const mismatch = context.filteredProviders.find(
      (fp: any) => fp.id === 1 && fp.reason === "format_type_mismatch"
    );
    expect(mismatch).toBeDefined();
    expect(mismatch.details).toContain("gemini-cli");
    expect(mismatch.details).toContain("gemini");
  });

  test("returns null when no compatible providers exist for response format", async () => {
    const ProxyProviderResolver = await setupResolverMocks();

    const p1 = createProvider(1, "claude");
    const p2 = createProvider(2, "openai-compatible");
    const session = createSessionStub("response", [p1, p2], "codex-mini-latest");

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider).toBeNull();

    const mismatches = context.filteredProviders.filter(
      (fp: any) => fp.reason === "format_type_mismatch"
    );
    expect(mismatches.length).toBe(2);
  });

  test("multiple incompatible providers are all recorded in filteredProviders", async () => {
    const ProxyProviderResolver = await setupResolverMocks();

    const p1 = createProvider(1, "claude");
    const p2 = createProvider(2, "codex");
    const p3 = createProvider(3, "gemini");
    const compatible = createProvider(4, "openai-compatible");
    const session = createSessionStub("openai", [p1, p2, p3, compatible], "gpt-4o");

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(4);

    const mismatches = context.filteredProviders.filter(
      (fp: any) => fp.reason === "format_type_mismatch"
    );
    expect(mismatches.length).toBe(3);
    expect(mismatches.map((m: any) => m.id).sort()).toEqual([1, 2, 3]);
  });
});
