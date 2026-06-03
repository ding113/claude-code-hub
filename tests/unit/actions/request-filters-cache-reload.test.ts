import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const reloadMock = vi.fn(async () => {});
const createRequestFilterMock = vi.fn();
const updateRequestFilterMock = vi.fn();
const deleteRequestFilterMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/request-filter-engine", () => ({
  requestFilterEngine: {
    reload: reloadMock,
    getStats: vi.fn(() => ({ count: 0 })),
  },
}));

vi.mock("@/repository/request-filters", () => ({
  createRequestFilter: createRequestFilterMock,
  deleteRequestFilter: deleteRequestFilterMock,
  getAllRequestFilters: vi.fn(async () => []),
  getRequestFilterById: vi.fn(async () => null),
  updateRequestFilter: updateRequestFilterMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const baseFilter = {
  id: 1,
  name: "f",
  description: null,
  scope: "header" as const,
  action: "remove" as const,
  matchType: null,
  target: "x-test",
  replacement: null,
  priority: 0,
  isEnabled: true,
  bindingType: "global" as const,
  providerIds: null,
  groupTags: null,
  ruleMode: "simple" as const,
  executionPhase: "guard" as const,
  operations: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
};

describe("request-filters actions reload the engine on mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
  });

  it("createRequestFilterAction reloads the engine after a successful create", async () => {
    createRequestFilterMock.mockResolvedValue(baseFilter);

    const { createRequestFilterAction } = await import("@/actions/request-filters");
    const res = await createRequestFilterAction({
      name: "f",
      scope: "header",
      action: "remove",
      target: "x-test",
      bindingType: "global",
    });

    expect(res.ok).toBe(true);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("updateRequestFilterAction reloads the engine after a successful update", async () => {
    updateRequestFilterMock.mockResolvedValue(baseFilter);

    const { updateRequestFilterAction } = await import("@/actions/request-filters");
    const res = await updateRequestFilterAction(1, { isEnabled: false });

    expect(res.ok).toBe(true);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("deleteRequestFilterAction reloads the engine after a successful delete", async () => {
    deleteRequestFilterMock.mockResolvedValue(true);

    const { deleteRequestFilterAction } = await import("@/actions/request-filters");
    const res = await deleteRequestFilterAction(1);

    expect(res.ok).toBe(true);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("does not reload the engine when the update target does not exist", async () => {
    updateRequestFilterMock.mockResolvedValue(null);

    const { updateRequestFilterAction } = await import("@/actions/request-filters");
    const res = await updateRequestFilterAction(999, { isEnabled: false });

    expect(res.ok).toBe(false);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("does not reload the engine when the delete target does not exist", async () => {
    deleteRequestFilterMock.mockResolvedValue(false);

    const { deleteRequestFilterAction } = await import("@/actions/request-filters");
    const res = await deleteRequestFilterAction(999);

    expect(res.ok).toBe(false);
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
