import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProxyProviderResolver } from "@/app/v1/_lib/proxy/provider-selector";
import type { Provider } from "@/types/provider";

const findAllProvidersMock = vi.hoisted(() => vi.fn<[], Promise<Provider[]>>());

vi.mock("@/repository/provider", () => {
  return {
    findAllProviders: findAllProvidersMock,
    findProviderById: vi.fn(),
  };
});

describe("ProxyProviderResolver - 路径前缀与模型联合路由", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(ProxyProviderResolver, "filterByLimits").mockImplementation(async (providers) => {
      return providers;
    });
    vi.spyOn(ProxyProviderResolver, "selectTopPriority").mockImplementation((providers) => {
      return providers;
    });
    vi.spyOn(ProxyProviderResolver, "selectOptimal").mockImplementation((providers) => {
      return (providers[0] ?? null) as unknown as Provider;
    });
  });

  test("同一命名空间下应按模型名路由到不同 provider", async () => {
    const elysiaWriter = {
      id: 11,
      name: "elysia_写作",
      isEnabled: true,
      providerType: "openai-compatible",
      groupTag: "writer",
      allowedModels: ["claude-4.5-sonnet"],
      weight: 1,
      priority: 0,
      costMultiplier: 1,
    } as unknown as Provider;

    const heiBaiWriter = {
      id: 12,
      name: "黑白_写作",
      isEnabled: true,
      providerType: "openai-compatible",
      groupTag: "writer",
      allowedModels: ["claude-4.6-sonnet"],
      weight: 1,
      priority: 0,
      costMultiplier: 1,
    } as unknown as Provider;

    findAllProvidersMock.mockResolvedValue([elysiaWriter, heiBaiWriter]);

    const session = {
      originalFormat: "openai",
      authState: null,
      getCurrentModel: () => "claude-4.6-sonnet",
      getRoutePrefix: () => "writer",
      getProvidersSnapshot: async () => [elysiaWriter, heiBaiWriter],
      clientRequestsContext1m: () => false,
    };

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(session);

    expect(provider?.id).toBe(12);
    expect(context.totalProviders).toBe(2);
    expect(context.enabledProviders).toBe(1);
    expect(context.groupFilterApplied).toBe(true);
  });
});
