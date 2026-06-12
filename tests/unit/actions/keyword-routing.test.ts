import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const reloadMock = vi.fn(async () => {});
const getStatsMock = vi.fn(() => ({
  ruleCount: 2,
  lastReloadTime: 1750000000000,
  isLoading: false,
}));
const emitActionAuditMock = vi.fn();
const createKeywordRoutingRuleMock = vi.fn();
const updateKeywordRoutingRuleMock = vi.fn();
const deleteKeywordRoutingRuleMock = vi.fn();
const getAllKeywordRoutingRulesMock = vi.fn(async () => []);

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

vi.mock("@/lib/keyword-routing/engine", () => ({
  keywordRoutingEngine: {
    reload: reloadMock,
    getStats: getStatsMock,
  },
}));

vi.mock("@/lib/audit/emit", () => ({
  emitActionAudit: emitActionAuditMock,
}));

vi.mock("@/repository/keyword-routing-rules", () => ({
  createKeywordRoutingRule: createKeywordRoutingRuleMock,
  updateKeywordRoutingRule: updateKeywordRoutingRuleMock,
  deleteKeywordRoutingRule: deleteKeywordRoutingRuleMock,
  getAllKeywordRoutingRules: getAllKeywordRoutingRulesMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const baseRule = {
  id: 1,
  keyword: "ultrathink",
  sourceModel: null,
  targetModel: "model-b",
  caseSensitive: true,
  priority: 0,
  description: null,
  isEnabled: true,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
};

describe("keyword-routing actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
  });

  describe("listKeywordRoutingRules", () => {
    it("returns rules from the repository for admins", async () => {
      getAllKeywordRoutingRulesMock.mockResolvedValue([baseRule]);

      const { listKeywordRoutingRules } = await import("@/actions/keyword-routing");
      const rules = await listKeywordRoutingRules();

      expect(rules).toEqual([baseRule]);
      expect(getAllKeywordRoutingRulesMock).toHaveBeenCalledTimes(1);
    });

    it("returns an empty list for non-admin sessions without touching the repository", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 2, role: "user" } });

      const { listKeywordRoutingRules } = await import("@/actions/keyword-routing");
      const rules = await listKeywordRoutingRules();

      expect(rules).toEqual([]);
      expect(getAllKeywordRoutingRulesMock).not.toHaveBeenCalled();
    });

    it("returns an empty list when the repository throws", async () => {
      getAllKeywordRoutingRulesMock.mockRejectedValue(new Error("db down"));

      const { listKeywordRoutingRules } = await import("@/actions/keyword-routing");
      const rules = await listKeywordRoutingRules();

      expect(rules).toEqual([]);
    });
  });

  describe("createKeywordRoutingRuleAction", () => {
    it("rejects an empty keyword without touching the repository", async () => {
      const { createKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await createKeywordRoutingRuleAction({ keyword: "", targetModel: "model-b" });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("关键词不能为空");
      expect(createKeywordRoutingRuleMock).not.toHaveBeenCalled();
    });

    it("rejects a whitespace-only keyword", async () => {
      const { createKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await createKeywordRoutingRuleAction({
        keyword: "   ",
        targetModel: "model-b",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("关键词不能为空");
      expect(createKeywordRoutingRuleMock).not.toHaveBeenCalled();
    });

    it("rejects an empty target model", async () => {
      const { createKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await createKeywordRoutingRuleAction({
        keyword: "ultrathink",
        targetModel: "  ",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("目标模型不能为空");
      expect(createKeywordRoutingRuleMock).not.toHaveBeenCalled();
    });

    it("rejects a keyword longer than 500 characters", async () => {
      const { createKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await createKeywordRoutingRuleAction({
        keyword: "k".repeat(501),
        targetModel: "model-b",
      });

      expect(res.ok).toBe(false);
      expect(createKeywordRoutingRuleMock).not.toHaveBeenCalled();
    });

    it("rejects a target model longer than 128 characters", async () => {
      const { createKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await createKeywordRoutingRuleAction({
        keyword: "ultrathink",
        targetModel: "m".repeat(129),
      });

      expect(res.ok).toBe(false);
      expect(createKeywordRoutingRuleMock).not.toHaveBeenCalled();
    });

    it("rejects a source model longer than 128 characters", async () => {
      const { createKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await createKeywordRoutingRuleAction({
        keyword: "ultrathink",
        sourceModel: "s".repeat(129),
        targetModel: "model-b",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("来源模型长度不能超过 128 个字符");
      expect(createKeywordRoutingRuleMock).not.toHaveBeenCalled();
    });

    it("rejects a description longer than 500 characters", async () => {
      const { createKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await createKeywordRoutingRuleAction({
        keyword: "ultrathink",
        targetModel: "model-b",
        description: "d".repeat(501),
      });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("描述长度不能超过 500 个字符");
      expect(createKeywordRoutingRuleMock).not.toHaveBeenCalled();
    });

    it("rejects a non-integer priority", async () => {
      const { createKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await createKeywordRoutingRuleAction({
        keyword: "ultrathink",
        targetModel: "model-b",
        priority: 1.5,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("优先级必须为整数");
      expect(createKeywordRoutingRuleMock).not.toHaveBeenCalled();
    });

    it("rejects a priority outside the +/-1000000 bounds", async () => {
      const { createKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await createKeywordRoutingRuleAction({
        keyword: "ultrathink",
        targetModel: "model-b",
        priority: 2000000,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("优先级必须在 -1000000 到 1000000 之间");
      expect(createKeywordRoutingRuleMock).not.toHaveBeenCalled();
    });

    it("returns an error result and emits a failure audit when the repository throws", async () => {
      createKeywordRoutingRuleMock.mockRejectedValue(new Error("db down"));

      const { createKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await createKeywordRoutingRuleAction({
        keyword: "ultrathink",
        targetModel: "model-b",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("创建关键词路由规则失败");
      expect(emitActionAuditMock).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "keyword_routing_rule",
          action: "keyword_routing_rule.create",
          success: false,
          errorMessage: "CREATE_FAILED",
        })
      );
    });

    it("passes a valid create through to the repository and emits an audit event", async () => {
      createKeywordRoutingRuleMock.mockResolvedValue(baseRule);

      const { createKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await createKeywordRoutingRuleAction({
        keyword: "ultrathink",
        targetModel: "model-b",
        priority: 5,
      });

      expect(res.ok).toBe(true);
      if (res.ok) expect(res.data).toEqual(baseRule);
      expect(createKeywordRoutingRuleMock).toHaveBeenCalledWith({
        keyword: "ultrathink",
        targetModel: "model-b",
        priority: 5,
      });
      expect(emitActionAuditMock).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "keyword_routing_rule",
          action: "keyword_routing_rule.create",
          success: true,
        })
      );
    });

    it("rejects non-admin sessions", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 2, role: "user" } });

      const { createKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await createKeywordRoutingRuleAction({
        keyword: "ultrathink",
        targetModel: "model-b",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("权限不足");
      expect(createKeywordRoutingRuleMock).not.toHaveBeenCalled();
    });
  });

  describe("updateKeywordRoutingRuleAction", () => {
    it("returns an error result when the rule does not exist", async () => {
      updateKeywordRoutingRuleMock.mockResolvedValue(null);

      const { updateKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await updateKeywordRoutingRuleAction(404, { isEnabled: false });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("关键词路由规则不存在");
      expect(emitActionAuditMock).not.toHaveBeenCalled();
    });

    it("validates provided fields before updating", async () => {
      const { updateKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await updateKeywordRoutingRuleAction(1, { keyword: "   " });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("关键词不能为空");
      expect(updateKeywordRoutingRuleMock).not.toHaveBeenCalled();
    });

    it("rejects an empty target model in updates", async () => {
      const { updateKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await updateKeywordRoutingRuleAction(1, { targetModel: "" });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("目标模型不能为空");
      expect(updateKeywordRoutingRuleMock).not.toHaveBeenCalled();
    });

    it("updates an existing rule and emits an audit event", async () => {
      updateKeywordRoutingRuleMock.mockResolvedValue({ ...baseRule, isEnabled: false });

      const { updateKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await updateKeywordRoutingRuleAction(1, { isEnabled: false });

      expect(res.ok).toBe(true);
      expect(updateKeywordRoutingRuleMock).toHaveBeenCalledWith(1, { isEnabled: false });
      expect(emitActionAuditMock).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "keyword_routing_rule",
          action: "keyword_routing_rule.update",
          success: true,
        })
      );
    });
  });

  describe("deleteKeywordRoutingRuleAction", () => {
    it("deletes an existing rule", async () => {
      deleteKeywordRoutingRuleMock.mockResolvedValue(true);

      const { deleteKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await deleteKeywordRoutingRuleAction(1);

      expect(res.ok).toBe(true);
      expect(deleteKeywordRoutingRuleMock).toHaveBeenCalledWith(1);
      expect(emitActionAuditMock).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "keyword_routing_rule",
          action: "keyword_routing_rule.delete",
          success: true,
        })
      );
    });

    it("returns an error result when the rule does not exist", async () => {
      deleteKeywordRoutingRuleMock.mockResolvedValue(false);

      const { deleteKeywordRoutingRuleAction } = await import("@/actions/keyword-routing");
      const res = await deleteKeywordRoutingRuleAction(404);

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("关键词路由规则不存在");
    });
  });

  describe("cache actions", () => {
    it("refreshKeywordRoutingCacheAction reloads the engine and returns stats", async () => {
      const { refreshKeywordRoutingCacheAction } = await import("@/actions/keyword-routing");
      const res = await refreshKeywordRoutingCacheAction();

      expect(res.ok).toBe(true);
      expect(reloadMock).toHaveBeenCalledTimes(1);
      if (res.ok) {
        expect(res.data).toEqual({
          stats: { ruleCount: 2, lastReloadTime: 1750000000000, isLoading: false },
        });
      }
    });

    it("getKeywordRoutingCacheStats returns stats for admins", async () => {
      const { getKeywordRoutingCacheStats } = await import("@/actions/keyword-routing");
      const stats = await getKeywordRoutingCacheStats();

      expect(stats).toEqual({ ruleCount: 2, lastReloadTime: 1750000000000, isLoading: false });
    });

    it("getKeywordRoutingCacheStats returns null for non-admins", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 2, role: "user" } });

      const { getKeywordRoutingCacheStats } = await import("@/actions/keyword-routing");
      const stats = await getKeywordRoutingCacheStats();

      expect(stats).toBeNull();
    });
  });
});
