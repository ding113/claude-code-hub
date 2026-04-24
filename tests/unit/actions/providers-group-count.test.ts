import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.hoisted(() => vi.fn());
const findAllProvidersFreshMock = vi.hoisted(() => vi.fn());
const findProviderByIdMock = vi.hoisted(() => vi.fn());
const getProviderStatisticsMock = vi.hoisted(() => vi.fn());
const createProviderMock = vi.hoisted(() => vi.fn());
const updateProviderMock = vi.hoisted(() => vi.fn());
const deleteProviderMock = vi.hoisted(() => vi.fn());
const updateProviderPrioritiesBatchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/provider", () => ({
  createProvider: createProviderMock,
  deleteProvider: deleteProviderMock,
  findAllProviders: vi.fn(async () => []),
  findAllProvidersFresh: findAllProvidersFreshMock,
  findProviderById: findProviderByIdMock,
  getProviderStatistics: getProviderStatisticsMock,
  resetProviderTotalCostResetAt: vi.fn(async () => {}),
  updateProvider: updateProviderMock,
  updateProviderPrioritiesBatch: updateProviderPrioritiesBatchMock,
  updateProvidersBatch: vi.fn(async () => 0),
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: vi.fn(),
}));

vi.mock("@/lib/redis/circuit-breaker-config", () => ({
  deleteProviderCircuitConfig: vi.fn(),
  saveProviderCircuitConfig: vi.fn(),
}));

vi.mock("@/lib/circuit-breaker", () => ({
  clearConfigCache: vi.fn(),
  clearProviderState: vi.fn(),
  forceCloseCircuitState: vi.fn(),
  getAllHealthStatusAsync: vi.fn(async () => ({})),
  publishCircuitBreakerConfigInvalidation: vi.fn(),
  resetCircuit: vi.fn(),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    terminateProviderSessionsBatch: vi.fn(async () => 0),
    terminateStickySessionsForProviders: vi.fn(async () => 0),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("getProviderGroupsWithCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findAllProvidersFreshMock.mockResolvedValue([
      { groupTag: null },
      { groupTag: "   " },
      { groupTag: "default" },
      { groupTag: "premium" },
    ]);
    findProviderByIdMock.mockResolvedValue(null);
    getProviderStatisticsMock.mockResolvedValue([]);
    createProviderMock.mockResolvedValue(null);
    updateProviderMock.mockResolvedValue(null);
    deleteProviderMock.mockResolvedValue(undefined);
    updateProviderPrioritiesBatchMock.mockResolvedValue(0);
  });

  it("counts null or blank group tags under default", async () => {
    const { getProviderGroupsWithCount } = await import("@/actions/providers");

    const result = await getProviderGroupsWithCount();

    expect(result).toEqual({
      ok: true,
      data: [
        { group: "default", providerCount: 3 },
        { group: "premium", providerCount: 1 },
      ],
    });
  });
});
