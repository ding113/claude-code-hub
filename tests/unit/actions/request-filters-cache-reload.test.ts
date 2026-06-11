import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const reloadMock = vi.fn(async () => {});
const createRequestFilterMock = vi.fn();
const updateRequestFilterMock = vi.fn();
const deleteRequestFilterMock = vi.fn();
const getRequestFilterByIdMock = vi.fn(async () => null);

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
  getRequestFilterById: getRequestFilterByIdMock,
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
    // reload(false): the repository emit already kicked off a fresh reload; the
    // action reuses it instead of forcing a redundant second DB read.
    expect(reloadMock).toHaveBeenCalledWith(false);
  });

  it("still returns ok:true when the engine reload throws (cache sync is best-effort)", async () => {
    createRequestFilterMock.mockResolvedValue(baseFilter);
    reloadMock.mockRejectedValueOnce(new Error("boom"));

    const { createRequestFilterAction } = await import("@/actions/request-filters");
    const res = await createRequestFilterAction({
      name: "f",
      scope: "header",
      action: "remove",
      target: "x-test",
      bindingType: "global",
    });

    // The DB write succeeded; a failed best-effort cache reload must NOT flip the
    // action to failed (which would prompt the user to retry and double-create).
    expect(res.ok).toBe(true);
    expect(reloadMock).toHaveBeenCalled();
  });

  it("updateRequestFilterAction reloads the engine after a successful update", async () => {
    updateRequestFilterMock.mockResolvedValue(baseFilter);

    const { updateRequestFilterAction } = await import("@/actions/request-filters");
    const res = await updateRequestFilterAction(1, { isEnabled: false });

    expect(res.ok).toBe(true);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("allows updating provider bindings on an advanced final filter with an empty target", async () => {
    const advancedFilter = {
      ...baseFilter,
      target: "",
      bindingType: "providers" as const,
      providerIds: [5, 4, 6],
      ruleMode: "advanced" as const,
      executionPhase: "final" as const,
      operations: [
        {
          op: "remove" as const,
          scope: "body" as const,
          path: "tools",
          matcher: { field: "type", value: "image_generation", matchType: "exact" as const },
        },
      ],
    };
    getRequestFilterByIdMock.mockResolvedValue(advancedFilter);
    updateRequestFilterMock.mockResolvedValue({ ...advancedFilter, providerIds: [5, 4, 6, 24] });

    const { updateRequestFilterAction } = await import("@/actions/request-filters");
    const res = await updateRequestFilterAction(1, { providerIds: [5, 4, 6, 24] });

    expect(res.ok).toBe(true);
    expect(updateRequestFilterMock).toHaveBeenCalledWith(1, { providerIds: [5, 4, 6, 24] });
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("validates binding updates against the effective updated rule mode", async () => {
    const advancedFilter = {
      ...baseFilter,
      target: "",
      bindingType: "providers" as const,
      providerIds: [5, 4, 6],
      ruleMode: "advanced" as const,
      executionPhase: "final" as const,
      operations: [
        {
          op: "remove" as const,
          scope: "body" as const,
          path: "tools",
          matcher: { field: "type", value: "image_generation", matchType: "exact" as const },
        },
      ],
    };
    getRequestFilterByIdMock.mockResolvedValue(advancedFilter);

    const { updateRequestFilterAction } = await import("@/actions/request-filters");
    const res = await updateRequestFilterAction(1, {
      providerIds: [5, 4, 6, 24],
      ruleMode: "simple",
      operations: null,
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBe("目标字段不能为空");
    expect(updateRequestFilterMock).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("allows advanced->simple conversion when a non-empty target is supplied", async () => {
    // Regression (U05): the binding-block revalidation must use the EFFECTIVE
    // post-update target, not the stale empty target stored on the advanced
    // filter. Switching to simple mode WITH a target must succeed.
    const advancedFilter = {
      ...baseFilter,
      target: "",
      bindingType: "providers" as const,
      providerIds: [5, 4, 6],
      ruleMode: "advanced" as const,
      executionPhase: "final" as const,
      operations: [
        {
          op: "remove" as const,
          scope: "body" as const,
          path: "tools",
          matcher: { field: "type", value: "image_generation", matchType: "exact" as const },
        },
      ],
    };
    getRequestFilterByIdMock.mockResolvedValue(advancedFilter);
    updateRequestFilterMock.mockResolvedValue({
      ...advancedFilter,
      target: "x-my-header",
      ruleMode: "simple",
      operations: null,
    });

    const { updateRequestFilterAction } = await import("@/actions/request-filters");
    const res = await updateRequestFilterAction(1, {
      providerIds: [5, 4, 6, 24],
      ruleMode: "simple",
      operations: null,
      target: "x-my-header",
    });

    expect(res.ok).toBe(true);
    expect(updateRequestFilterMock).toHaveBeenCalledTimes(1);
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
