import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const reloadMock = vi.fn(async () => {});
const emitErrorRulesUpdatedMock = vi.fn(async () => {});
const createErrorRuleMock = vi.fn();
const updateErrorRuleMock = vi.fn();
const deleteErrorRuleMock = vi.fn();
const getErrorRuleByIdMock = vi.fn();

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

vi.mock("@/lib/emit-event", () => ({
  emitErrorRulesUpdated: emitErrorRulesUpdatedMock,
}));

vi.mock("@/lib/error-override-validator", () => ({
  validateErrorOverrideResponse: vi.fn(() => null),
}));

vi.mock("@/lib/error-rule-detector", () => ({
  errorRuleDetector: {
    reload: reloadMock,
    getStats: vi.fn(() => ({ totalCount: 0 })),
    ensureInitialized: vi.fn(async () => {}),
    detectAsync: vi.fn(async () => ({ matched: false })),
  },
}));

vi.mock("@/repository/error-rules", () => ({
  createErrorRule: createErrorRuleMock,
  updateErrorRule: updateErrorRuleMock,
  deleteErrorRule: deleteErrorRuleMock,
  getErrorRuleById: getErrorRuleByIdMock,
  getAllErrorRules: vi.fn(async () => []),
  syncDefaultErrorRules: vi.fn(async () => ({ inserted: 0, updated: 0, skipped: 0, deleted: 0 })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const baseRule = {
  id: 1,
  pattern: "boom",
  category: "prompt_limit" as const,
  matchType: "contains" as const,
  description: null,
  overrideResponse: null,
  overrideStatusCode: null,
  isEnabled: true,
  isDefault: false,
  priority: 0,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
};

describe("error-rules actions reload the detector on mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
  });

  it("createErrorRuleAction reloads the detector after a successful create", async () => {
    createErrorRuleMock.mockResolvedValue(baseRule);

    const { createErrorRuleAction } = await import("@/actions/error-rules");
    const res = await createErrorRuleAction({
      pattern: "boom",
      category: "prompt_limit",
      matchType: "contains",
    });

    expect(res.ok).toBe(true);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("updateErrorRuleAction reloads the detector after a successful update", async () => {
    getErrorRuleByIdMock.mockResolvedValue(baseRule);
    updateErrorRuleMock.mockResolvedValue({ ...baseRule, isEnabled: false });

    const { updateErrorRuleAction } = await import("@/actions/error-rules");
    const res = await updateErrorRuleAction(1, { isEnabled: false });

    expect(res.ok).toBe(true);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("deleteErrorRuleAction reloads the detector after a successful delete", async () => {
    deleteErrorRuleMock.mockResolvedValue(true);

    const { deleteErrorRuleAction } = await import("@/actions/error-rules");
    const res = await deleteErrorRuleAction(1);

    expect(res.ok).toBe(true);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("does not reload the detector when the delete target does not exist", async () => {
    deleteErrorRuleMock.mockResolvedValue(false);

    const { deleteErrorRuleAction } = await import("@/actions/error-rules");
    const res = await deleteErrorRuleAction(999);

    expect(res.ok).toBe(false);
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
