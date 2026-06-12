import { describe, expect, test, vi } from "vitest";

function createDbMock(options: {
  insertReturning: unknown[];
  updateReturning: unknown[];
  deleteReturning: unknown[];
}) {
  const valuesMock = vi.fn(() => ({
    returning: vi.fn(async () => options.insertReturning),
  }));
  const setMock = vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn(async () => options.updateReturning),
    })),
  }));

  const db = {
    insert: vi.fn(() => ({
      values: valuesMock,
    })),
    update: vi.fn(() => ({
      set: setMock,
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => options.deleteReturning),
      })),
    })),
    query: {
      keywordRoutingRules: {
        findMany: vi.fn(),
      },
    },
  };

  return { db, valuesMock, setMock };
}

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    keyword: "ultrathink",
    sourceModel: null,
    targetModel: "claude-opus-4-5",
    caseSensitive: true,
    priority: 0,
    description: null,
    isEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockModules(db: unknown, emitKeywordRoutingRulesUpdated: ReturnType<typeof vi.fn>) {
  vi.doMock("@/drizzle/db", () => ({ db }));
  vi.doMock("@/drizzle/schema", () => ({
    keywordRoutingRules: { id: {}, priority: {}, isEnabled: {} },
  }));
  vi.doMock("drizzle-orm", () => ({ eq: vi.fn(() => ({})) }));
  vi.doMock("@/lib/emit-event", () => ({ emitKeywordRoutingRulesUpdated }));
}

describe("Keyword routing rules repository events", () => {
  test("createKeywordRoutingRule: should emitKeywordRoutingRulesUpdated", async () => {
    vi.resetModules();

    const emitKeywordRoutingRulesUpdated = vi.fn(async () => undefined);
    const { db } = createDbMock({
      insertReturning: [createRow()],
      updateReturning: [],
      deleteReturning: [],
    });

    mockModules(db, emitKeywordRoutingRulesUpdated);

    const repo = await import("@/repository/keyword-routing-rules");
    await repo.createKeywordRoutingRule({
      keyword: "ultrathink",
      targetModel: "claude-opus-4-5",
    });

    expect(emitKeywordRoutingRulesUpdated).toHaveBeenCalledTimes(1);
  });

  test("createKeywordRoutingRule: should normalize empty sourceModel to null and trim inputs", async () => {
    vi.resetModules();

    const emitKeywordRoutingRulesUpdated = vi.fn(async () => undefined);
    const { db, valuesMock } = createDbMock({
      insertReturning: [createRow()],
      updateReturning: [],
      deleteReturning: [],
    });

    mockModules(db, emitKeywordRoutingRulesUpdated);

    const repo = await import("@/repository/keyword-routing-rules");
    await repo.createKeywordRoutingRule({
      keyword: "  ultrathink  ",
      sourceModel: "  ",
      targetModel: " claude-opus-4-5 ",
    });

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        keyword: "ultrathink",
        sourceModel: null,
        targetModel: "claude-opus-4-5",
      })
    );
  });

  test("updateKeywordRoutingRule: should emitKeywordRoutingRulesUpdated when row found", async () => {
    vi.resetModules();

    const emitKeywordRoutingRulesUpdated = vi.fn(async () => undefined);
    const { db } = createDbMock({
      insertReturning: [],
      updateReturning: [createRow()],
      deleteReturning: [],
    });

    mockModules(db, emitKeywordRoutingRulesUpdated);

    const repo = await import("@/repository/keyword-routing-rules");
    const result = await repo.updateKeywordRoutingRule(1, { keyword: "updated" });

    expect(result).not.toBeNull();
    expect(emitKeywordRoutingRulesUpdated).toHaveBeenCalledTimes(1);
  });

  test("updateKeywordRoutingRule: should set updatedAt and normalize empty sourceModel to null", async () => {
    vi.resetModules();

    const emitKeywordRoutingRulesUpdated = vi.fn(async () => undefined);
    const { db, setMock } = createDbMock({
      insertReturning: [],
      updateReturning: [createRow()],
      deleteReturning: [],
    });

    mockModules(db, emitKeywordRoutingRulesUpdated);

    const repo = await import("@/repository/keyword-routing-rules");
    await repo.updateKeywordRoutingRule(1, { sourceModel: "" });

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceModel: null,
        updatedAt: expect.any(Date),
      })
    );
  });

  test("updateKeywordRoutingRule: should not emitKeywordRoutingRulesUpdated when row not found", async () => {
    vi.resetModules();

    const emitKeywordRoutingRulesUpdated = vi.fn(async () => undefined);
    const { db } = createDbMock({
      insertReturning: [],
      updateReturning: [],
      deleteReturning: [],
    });

    mockModules(db, emitKeywordRoutingRulesUpdated);

    const repo = await import("@/repository/keyword-routing-rules");
    const result = await repo.updateKeywordRoutingRule(1, { keyword: "updated" });

    expect(result).toBeNull();
    expect(emitKeywordRoutingRulesUpdated).not.toHaveBeenCalled();
  });

  test("deleteKeywordRoutingRule: should emitKeywordRoutingRulesUpdated when row deleted", async () => {
    vi.resetModules();

    const emitKeywordRoutingRulesUpdated = vi.fn(async () => undefined);
    const { db } = createDbMock({
      insertReturning: [],
      updateReturning: [],
      deleteReturning: [createRow()],
    });

    mockModules(db, emitKeywordRoutingRulesUpdated);

    const repo = await import("@/repository/keyword-routing-rules");
    const deleted = await repo.deleteKeywordRoutingRule(1);

    expect(deleted).toBe(true);
    expect(emitKeywordRoutingRulesUpdated).toHaveBeenCalledTimes(1);
  });

  test("deleteKeywordRoutingRule: should not emitKeywordRoutingRulesUpdated when row not deleted", async () => {
    vi.resetModules();

    const emitKeywordRoutingRulesUpdated = vi.fn(async () => undefined);
    const { db } = createDbMock({
      insertReturning: [],
      updateReturning: [],
      deleteReturning: [],
    });

    mockModules(db, emitKeywordRoutingRulesUpdated);

    const repo = await import("@/repository/keyword-routing-rules");
    const deleted = await repo.deleteKeywordRoutingRule(1);

    expect(deleted).toBe(false);
    expect(emitKeywordRoutingRulesUpdated).not.toHaveBeenCalled();
  });
});
