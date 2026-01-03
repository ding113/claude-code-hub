import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";
import { ProxyProviderResolver } from "@/app/v1/_lib/proxy/provider-selector";

const findAllProvidersMock = vi.hoisted(() => vi.fn<[], Promise<Provider[]>>());

vi.mock("@/repository/provider", () => {
  return {
    findAllProviders: findAllProvidersMock,
    findProviderById: vi.fn(),
  };
});

describe("ProxyProviderResolver.selectProviderByType - /v1/models 分组隔离", () => {
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

  test("当配置分组但匹配 0 个供应商时，应 fail closed（不回退到全量）", async () => {
    findAllProvidersMock.mockResolvedValue([
      {
        id: 1,
        name: "p1",
        isEnabled: true,
        providerType: "openai-compatible",
        groupTag: "other",
        weight: 1,
        priority: 0,
        costMultiplier: 1,
      } as unknown as Provider,
    ]);

    const { provider, context } = await ProxyProviderResolver.selectProviderByType(
      {
        user: { id: 1, providerGroup: "groupA" },
        key: { providerGroup: null },
      },
      "openai-compatible"
    );

    expect(provider).toBeNull();
    expect(context.groupFilterApplied).toBe(true);
    expect(context.userGroup).toBe("groupA");
    expect(context.totalProviders).toBe(0);
  });

  test("当分组匹配到供应商时，应只在分组内选择", async () => {
    const inGroup = {
      id: 1,
      name: "in-group",
      isEnabled: true,
      providerType: "openai-compatible",
      groupTag: "groupA",
      weight: 1,
      priority: 0,
      costMultiplier: 1,
    } as unknown as Provider;

    const outGroup = {
      id: 2,
      name: "out-group",
      isEnabled: true,
      providerType: "openai-compatible",
      groupTag: "groupB",
      weight: 100,
      priority: 0,
      costMultiplier: 1,
    } as unknown as Provider;

    findAllProvidersMock.mockResolvedValue([outGroup, inGroup]);

    const { provider } = await ProxyProviderResolver.selectProviderByType(
      {
        user: { id: 1, providerGroup: "groupA" },
        key: { providerGroup: null },
      },
      "openai-compatible"
    );

    expect(provider?.id).toBe(inGroup.id);
  });
});
