import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider, ProviderEndpoint } from "@/types/provider";

const findProviderEndpointsByVendorTypeMock = vi.hoisted(() =>
  vi.fn<[vendorId: number, providerType: Provider["providerType"]], Promise<ProviderEndpoint[]>>()
);

vi.mock("@/repository/provider-endpoint", () => ({
  findProviderEndpointsByVendorType: findProviderEndpointsByVendorTypeMock,
}));

const endpointCircuitBreakerMocks = vi.hoisted(() => ({
  isEndpointCircuitOpen: vi.fn((_: number) => false),
  openVendorTypeFuse: vi.fn(),
}));

vi.mock("@/lib/endpoint-circuit-breaker", () => endpointCircuitBreakerMocks);

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

function makeProvider(partial: Partial<Provider>): Provider {
  return {
    url: "https://provider.example",
    providerType: "claude",
    vendorId: null,
    ...partial,
  } as unknown as Provider;
}

function makeEndpoint(partial: Partial<ProviderEndpoint>): ProviderEndpoint {
  return {
    id: 1,
    vendorId: 10,
    providerType: "claude",
    baseUrl: "https://endpoint.example",
    isEnabled: true,
    priority: 0,
    weight: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...partial,
  } as unknown as ProviderEndpoint;
}

describe("EndpointResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    endpointCircuitBreakerMocks.isEndpointCircuitOpen.mockImplementation(() => false);
  });

  test("无 vendorId 时应回退到 provider.url，并清空 session endpoint", async () => {
    vi.resetModules();

    const { EndpointResolver } = await import("@/app/v1/_lib/proxy/endpoint-resolver");

    const setProviderEndpoint = vi.fn();
    const session = {
      setProviderEndpoint,
    } satisfies {
      setProviderEndpoint: (endpoint: ProviderEndpoint | null) => void;
    };

    const provider = makeProvider({
      url: "https://fallback.example",
      vendorId: null,
      providerType: "claude",
    });

    const resolved = await EndpointResolver.resolve(session, provider);

    expect(resolved).toBe("https://fallback.example");
    expect(setProviderEndpoint).toHaveBeenCalledWith(null);
    expect(findProviderEndpointsByVendorTypeMock).not.toHaveBeenCalled();
    expect(endpointCircuitBreakerMocks.openVendorTypeFuse).not.toHaveBeenCalled();
  });

  test("vendorId 存在但无 endpoints 时应回退到 provider.url", async () => {
    vi.resetModules();

    findProviderEndpointsByVendorTypeMock.mockResolvedValue([]);

    const { EndpointResolver } = await import("@/app/v1/_lib/proxy/endpoint-resolver");

    const setProviderEndpoint = vi.fn();
    const session = {
      setProviderEndpoint,
    } satisfies {
      setProviderEndpoint: (endpoint: ProviderEndpoint | null) => void;
    };

    const provider = makeProvider({
      url: "https://fallback.example",
      vendorId: 10,
      providerType: "claude",
    });

    const resolved = await EndpointResolver.resolve(session, provider);

    expect(resolved).toBe("https://fallback.example");
    expect(setProviderEndpoint).toHaveBeenCalledWith(null);
    expect(findProviderEndpointsByVendorTypeMock).toHaveBeenCalledWith(10, "claude");
    expect(endpointCircuitBreakerMocks.openVendorTypeFuse).not.toHaveBeenCalled();
  });

  test("所有 endpoints 不可用时应打开 vendor+type fuse 并抛出异常", async () => {
    vi.resetModules();

    findProviderEndpointsByVendorTypeMock.mockResolvedValue([
      makeEndpoint({ id: 1, isEnabled: false, baseUrl: "https://a.example" }),
      makeEndpoint({ id: 2, isEnabled: false, baseUrl: "https://b.example" }),
    ]);

    const { EndpointResolver, EndpointResolutionError } = await import(
      "@/app/v1/_lib/proxy/endpoint-resolver"
    );

    const setProviderEndpoint = vi.fn();
    const session = {
      setProviderEndpoint,
    } satisfies {
      setProviderEndpoint: (endpoint: ProviderEndpoint | null) => void;
    };

    const provider = makeProvider({ vendorId: 10, providerType: "claude" });

    await expect(EndpointResolver.resolve(session, provider)).rejects.toBeInstanceOf(
      EndpointResolutionError
    );

    expect(setProviderEndpoint).toHaveBeenCalledWith(null);
    expect(endpointCircuitBreakerMocks.openVendorTypeFuse).toHaveBeenCalledWith({
      vendorId: 10,
      providerType: "claude",
      reason: "no_enabled_endpoints",
    });
  });

  test("所有 endpoints 熔断时应打开 vendor+type fuse 并抛出异常", async () => {
    vi.resetModules();

    findProviderEndpointsByVendorTypeMock.mockResolvedValue([
      makeEndpoint({ id: 1, isEnabled: true, baseUrl: "https://a.example" }),
      makeEndpoint({ id: 2, isEnabled: true, baseUrl: "https://b.example" }),
    ]);

    endpointCircuitBreakerMocks.isEndpointCircuitOpen.mockImplementation(() => true);

    const { EndpointResolver, EndpointResolutionError } = await import(
      "@/app/v1/_lib/proxy/endpoint-resolver"
    );

    const setProviderEndpoint = vi.fn();
    const session = {
      setProviderEndpoint,
    } satisfies {
      setProviderEndpoint: (endpoint: ProviderEndpoint | null) => void;
    };

    const provider = makeProvider({ vendorId: 10, providerType: "claude" });

    await expect(EndpointResolver.resolve(session, provider)).rejects.toBeInstanceOf(
      EndpointResolutionError
    );

    expect(setProviderEndpoint).toHaveBeenCalledWith(null);
    expect(endpointCircuitBreakerMocks.openVendorTypeFuse).toHaveBeenCalledWith({
      vendorId: 10,
      providerType: "claude",
      reason: "all_endpoints_unhealthy",
    });
  });

  test("应在最优先级 endpoints 中按 weight 选择，并写入 session endpoint", async () => {
    vi.resetModules();

    const endpoints = [
      makeEndpoint({ id: 1, baseUrl: "https://a.example", priority: 0, weight: 1 }),
      makeEndpoint({ id: 2, baseUrl: "https://b.example", priority: 0, weight: 9 }),
      makeEndpoint({ id: 3, baseUrl: "https://c.example", priority: 1, weight: 999 }),
    ];

    findProviderEndpointsByVendorTypeMock.mockResolvedValue(endpoints);

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.95);

    const { EndpointResolver } = await import("@/app/v1/_lib/proxy/endpoint-resolver");

    const setProviderEndpoint = vi.fn();
    const session = {
      setProviderEndpoint,
    } satisfies {
      setProviderEndpoint: (endpoint: ProviderEndpoint | null) => void;
    };

    const provider = makeProvider({ vendorId: 10, providerType: "claude" });

    const resolved = await EndpointResolver.resolve(session, provider);

    expect(resolved).toBe("https://b.example");
    expect(setProviderEndpoint).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));

    randomSpy.mockRestore();
  });
});
