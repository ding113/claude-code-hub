import { describe, expect, test, vi } from "vitest";

function createDbMock(options: {
  insertReturning: unknown[];
  updateReturning: unknown[];
  deleteReturning: unknown[];
}) {
  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => options.insertReturning),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => options.updateReturning),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => options.deleteReturning),
      })),
    })),
    query: {
      sensitiveWords: {
        findMany: vi.fn(),
      },
    },
  };
}

describe("Sensitive words repository events", () => {
  test("createSensitiveWord: should emitSensitiveWordsUpdated", async () => {
    vi.resetModules();

    const emitSensitiveWordsUpdated = vi.fn(async () => undefined);
    const row = {
      id: 1,
      word: "test",
      matchType: "contains",
      description: null,
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = createDbMock({
      insertReturning: [row],
      updateReturning: [],
      deleteReturning: [],
    });

    vi.doMock("@/drizzle/db", () => ({ db }));
    vi.doMock("@/drizzle/schema", () => ({ sensitiveWords: { id: {} } }));
    vi.doMock("drizzle-orm", () => ({ eq: vi.fn(() => ({})), desc: vi.fn() }));
    vi.doMock("@/lib/emit-event", () => ({ emitSensitiveWordsUpdated }));

    const repo = await import("@/repository/sensitive-words");
    await repo.createSensitiveWord({ word: "test", matchType: "contains" });

    expect(emitSensitiveWordsUpdated).toHaveBeenCalledTimes(1);
  });

  test("updateSensitiveWord: should emitSensitiveWordsUpdated when row found", async () => {
    vi.resetModules();

    const emitSensitiveWordsUpdated = vi.fn(async () => undefined);
    const row = {
      id: 1,
      word: "test",
      matchType: "contains",
      description: null,
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = createDbMock({
      insertReturning: [],
      updateReturning: [row],
      deleteReturning: [],
    });

    vi.doMock("@/drizzle/db", () => ({ db }));
    vi.doMock("@/drizzle/schema", () => ({ sensitiveWords: { id: {} } }));
    vi.doMock("drizzle-orm", () => ({ eq: vi.fn(() => ({})), desc: vi.fn() }));
    vi.doMock("@/lib/emit-event", () => ({ emitSensitiveWordsUpdated }));

    const repo = await import("@/repository/sensitive-words");
    const result = await repo.updateSensitiveWord(1, { word: "updated" });

    expect(result).not.toBeNull();
    expect(emitSensitiveWordsUpdated).toHaveBeenCalledTimes(1);
  });

  test("updateSensitiveWord: should not emitSensitiveWordsUpdated when row not found", async () => {
    vi.resetModules();

    const emitSensitiveWordsUpdated = vi.fn(async () => undefined);
    const db = createDbMock({
      insertReturning: [],
      updateReturning: [],
      deleteReturning: [],
    });

    vi.doMock("@/drizzle/db", () => ({ db }));
    vi.doMock("@/drizzle/schema", () => ({ sensitiveWords: { id: {} } }));
    vi.doMock("drizzle-orm", () => ({ eq: vi.fn(() => ({})), desc: vi.fn() }));
    vi.doMock("@/lib/emit-event", () => ({ emitSensitiveWordsUpdated }));

    const repo = await import("@/repository/sensitive-words");
    const result = await repo.updateSensitiveWord(1, { word: "updated" });

    expect(result).toBeNull();
    expect(emitSensitiveWordsUpdated).not.toHaveBeenCalled();
  });

  test("deleteSensitiveWord: should emitSensitiveWordsUpdated when row deleted", async () => {
    vi.resetModules();

    const emitSensitiveWordsUpdated = vi.fn(async () => undefined);
    const row = {
      id: 1,
      word: "test",
      matchType: "contains",
      description: null,
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = createDbMock({
      insertReturning: [],
      updateReturning: [],
      deleteReturning: [row],
    });

    vi.doMock("@/drizzle/db", () => ({ db }));
    vi.doMock("@/drizzle/schema", () => ({ sensitiveWords: { id: {} } }));
    vi.doMock("drizzle-orm", () => ({ eq: vi.fn(() => ({})), desc: vi.fn() }));
    vi.doMock("@/lib/emit-event", () => ({ emitSensitiveWordsUpdated }));

    const repo = await import("@/repository/sensitive-words");
    const deleted = await repo.deleteSensitiveWord(1);

    expect(deleted).toBe(true);
    expect(emitSensitiveWordsUpdated).toHaveBeenCalledTimes(1);
  });

  test("deleteSensitiveWord: should not emitSensitiveWordsUpdated when row not deleted", async () => {
    vi.resetModules();

    const emitSensitiveWordsUpdated = vi.fn(async () => undefined);
    const db = createDbMock({
      insertReturning: [],
      updateReturning: [],
      deleteReturning: [],
    });

    vi.doMock("@/drizzle/db", () => ({ db }));
    vi.doMock("@/drizzle/schema", () => ({ sensitiveWords: { id: {} } }));
    vi.doMock("drizzle-orm", () => ({ eq: vi.fn(() => ({})), desc: vi.fn() }));
    vi.doMock("@/lib/emit-event", () => ({ emitSensitiveWordsUpdated }));

    const repo = await import("@/repository/sensitive-words");
    const deleted = await repo.deleteSensitiveWord(1);

    expect(deleted).toBe(false);
    expect(emitSensitiveWordsUpdated).not.toHaveBeenCalled();
  });
});

