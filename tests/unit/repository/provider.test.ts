import { describe, expect, test, vi } from "vitest";

function sqlToString(sqlObj: unknown): string {
  const stack = new Set<object>();

  const walk = (node: unknown): string => {
    if (node === null || node === undefined) return "";

    if (typeof node === "string") {
      return node;
    }

    if (typeof node === "number" || typeof node === "bigint" || typeof node === "boolean") {
      return String(node);
    }

    if (typeof node === "object") {
      if (stack.has(node)) return "";
      stack.add(node);

      try {
        const anyNode = node as any;
        if (Array.isArray(anyNode)) {
          return anyNode.map(walk).join("");
        }

        if (Object.hasOwn(anyNode, "value")) {
          const { value } = anyNode;
          if (Array.isArray(value)) {
            return value.map(String).join("");
          }
          if (value === null || value === undefined) return "";
          return String(value);
        }

        if (anyNode.queryChunks) {
          return walk(anyNode.queryChunks);
        }
      } finally {
        stack.delete(node);
      }
    }

    return "";
  };

  return walk(sqlObj);
}

function getSelectFieldKeys(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== "object") return [];
  return Object.keys(value as Record<string, unknown>);
}

describe("provider repository - updateProviderPrioritiesBatch", () => {
  test("returns 0 and does not execute SQL when updates is empty", async () => {
    vi.resetModules();

    const executeMock = vi.fn(async (_query: unknown) => ({ rowCount: 0 }));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        execute: executeMock,
      },
    }));

    const { updateProviderPrioritiesBatch } = await import("../../../src/repository/provider");
    const result = await updateProviderPrioritiesBatch([]);

    expect(result).toBe(0);
    expect(executeMock).not.toHaveBeenCalled();
  });

  test("generates CASE batch update SQL and returns affected rows", async () => {
    vi.resetModules();

    const executeMock = vi.fn(async (_query: unknown) => ({ rowCount: 2 }));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        execute: executeMock,
      },
    }));

    const { updateProviderPrioritiesBatch } = await import("../../../src/repository/provider");
    const result = await updateProviderPrioritiesBatch([
      { id: 1, priority: 0 },
      { id: 2, priority: 3 },
    ]);

    expect(result).toBe(2);
    expect(executeMock).toHaveBeenCalledTimes(1);

    const queryArg = executeMock.mock.calls[0]?.[0];
    const sqlText = sqlToString(queryArg).replace(/\s+/g, " ").trim();

    expect(sqlText).toContain("UPDATE providers");
    expect(sqlText).toContain("SET");
    expect(sqlText).toContain("priority = CASE id");
    expect(sqlText).toContain("WHEN 1 THEN 0");
    expect(sqlText).toContain("WHEN 2 THEN 3");
    expect(sqlText).toContain("updated_at = NOW()");
    expect(sqlText).toContain("WHERE id IN (1, 2) AND deleted_at IS NULL");
  });

  test("deduplicates provider ids (last update wins)", async () => {
    vi.resetModules();

    const executeMock = vi.fn(async (_query: unknown) => ({ rowCount: 1 }));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        execute: executeMock,
      },
    }));

    const { updateProviderPrioritiesBatch } = await import("../../../src/repository/provider");
    const result = await updateProviderPrioritiesBatch([
      { id: 1, priority: 0 },
      { id: 1, priority: 2 },
    ]);

    expect(result).toBe(1);
    expect(executeMock).toHaveBeenCalledTimes(1);

    const queryArg = executeMock.mock.calls[0]?.[0];
    const sqlText = sqlToString(queryArg).replace(/\s+/g, " ").trim();

    expect(sqlText).toContain("WHEN 1 THEN 2");
    expect(sqlText).toContain("WHERE id IN (1) AND deleted_at IS NULL");
  });
});

describe("provider repository - sessionTtl projection", () => {
  test("findProviderList should select sessionTtl", async () => {
    vi.resetModules();

    let capturedSelectFields: unknown;

    const offsetMock = vi.fn(async () => []);
    const limitMock = vi.fn(() => ({ offset: offsetMock }));
    const orderByMock = vi.fn(() => ({ limit: limitMock }));
    const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
    const fromMock = vi.fn(() => ({ where: whereMock }));
    const selectMock = vi.fn((fields: unknown) => {
      capturedSelectFields = fields;
      return { from: fromMock };
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
      },
    }));

    const { findProviderList } = await import("../../../src/repository/provider");
    await findProviderList(10, 0);

    expect(getSelectFieldKeys(capturedSelectFields)).toContain("sessionTtl");
  });

  test("findAllProvidersFresh should select sessionTtl", async () => {
    vi.resetModules();

    let capturedSelectFields: unknown;

    const orderByMock = vi.fn(async () => []);
    const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
    const fromMock = vi.fn(() => ({ where: whereMock }));
    const selectMock = vi.fn((fields: unknown) => {
      capturedSelectFields = fields;
      return { from: fromMock };
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
      },
    }));

    const { findAllProvidersFresh } = await import("../../../src/repository/provider");
    await findAllProvidersFresh();

    expect(getSelectFieldKeys(capturedSelectFields)).toContain("sessionTtl");
  });

  test("findProviderById should select sessionTtl", async () => {
    vi.resetModules();

    let capturedSelectFields: unknown;

    const whereMock = vi.fn(async () => []);
    const fromMock = vi.fn(() => ({ where: whereMock }));
    const selectMock = vi.fn((fields: unknown) => {
      capturedSelectFields = fields;
      return { from: fromMock };
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
      },
    }));

    const { findProviderById } = await import("../../../src/repository/provider");
    await findProviderById(1);

    expect(getSelectFieldKeys(capturedSelectFields)).toContain("sessionTtl");
  });

  test("updateProvider should return sessionTtl in returning projection", async () => {
    vi.resetModules();

    let capturedReturningFields: unknown;

    const returningMock = vi.fn(async (fields: unknown) => {
      capturedReturningFields = fields;
      return [];
    });
    const whereMock = vi.fn(() => ({ returning: returningMock }));
    const setMock = vi.fn(() => ({ where: whereMock }));
    const updateMock = vi.fn(() => ({ set: setMock }));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        update: updateMock,
      },
    }));

    const { updateProvider } = await import("../../../src/repository/provider");
    await updateProvider(1, { name: "provider" });

    expect(getSelectFieldKeys(capturedReturningFields)).toContain("sessionTtl");
  });
});
