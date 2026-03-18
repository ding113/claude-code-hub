import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

const circuitBreakerMocks = vi.hoisted(() => ({
  isCircuitOpen: vi.fn(async () => false),
  getCircuitState: vi.fn(() => "closed"),
}));

vi.mock("@/lib/circuit-breaker", () => circuitBreakerMocks);

describe("ProxyProviderResolver.pickRandomProvider - resource endpoints without model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createSessionStub(originalFormat: string, providers: Provider[]) {
    return {
      originalFormat,
      authState: null,
      getProvidersSnapshot: async () => providers,
      getOriginalModel: () => "",
      getCurrentModel: () => null,
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
      allowedModels: ["guarded-model"],
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

  test("openai 资源端点在无 model 时仍应选择 openai-compatible provider", async () => {
    const ProxyProviderResolver = await setupResolverMocks();

    const incompatible = createProvider(1, "claude");
    const compatible = createProvider(2, "openai-compatible");
    const session = createSessionStub("openai", [incompatible, compatible]);

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(2);
    expect(provider?.providerType).toBe("openai-compatible");
    expect(context.requestedModel).toBe("");
  });

  test("response 资源端点在无 model 时仍应选择 codex provider", async () => {
    const ProxyProviderResolver = await setupResolverMocks();

    const incompatible = createProvider(1, "openai-compatible");
    const compatible = createProvider(2, "codex");
    const session = createSessionStub("response", [incompatible, compatible]);

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(2);
    expect(provider?.providerType).toBe("codex");
    expect(context.requestedModel).toBe("");
  });

  test("gemini 资源端点在无 model 时仍应选择 gemini provider", async () => {
    const ProxyProviderResolver = await setupResolverMocks();

    const incompatible = createProvider(1, "gemini-cli");
    const compatible = createProvider(2, "gemini");
    const session = createSessionStub("gemini", [incompatible, compatible]);

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(2);
    expect(provider?.providerType).toBe("gemini");
    expect(context.requestedModel).toBe("");
  });
});
