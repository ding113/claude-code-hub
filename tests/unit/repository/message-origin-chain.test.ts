import { describe, expect, test, vi } from "vitest";
import type { ProviderChainItem } from "@/types/message";

function sqlToString(sqlObj: unknown): string {
  const visited = new Set<unknown>();

  const walk = (node: unknown): string => {
    if (!node || visited.has(node)) return "";
    visited.add(node);

    if (typeof node === "string") return node;

    if (typeof node === "object") {
      const anyNode = node as any;
      if (Array.isArray(anyNode)) {
        return anyNode.map(walk).join("");
      }

      if (anyNode.name && typeof anyNode.name === "string") {
        return anyNode.name;
      }

      if (anyNode.value) {
        if (Array.isArray(anyNode.value)) {
          return anyNode.value.map(String).join("");
        }
        return String(anyNode.value);
      }

      if (anyNode.queryChunks) {
        return walk(anyNode.queryChunks);
      }
    }

    return "";
  };

  return walk(sqlObj);
}

function createThenableQuery<T>(
  result: T,
  opts?: {
    whereArgs?: unknown[];
    orderByArgs?: unknown[];
    limitArgs?: unknown[];
  }
) {
  const query: any = Promise.resolve(result);

  query.from = vi.fn(() => query);
  query.where = vi.fn((arg: unknown) => {
    opts?.whereArgs?.push(arg);
    return query;
  });
  query.orderBy = vi.fn((...args: unknown[]) => {
    opts?.orderByArgs?.push(args);
    return query;
  });
  query.limit = vi.fn((arg: unknown) => {
    opts?.limitArgs?.push(arg);
    return query;
  });

  return query;
}

describe("repository/message findSessionOriginChain", () => {
  test("happy path: 返回 session 首条非 warmup 的完整 providerChain", async () => {
    vi.resetModules();

    const whereArgs: unknown[] = [];
    const orderByArgs: unknown[] = [];
    const limitArgs: unknown[] = [];

    const chain: ProviderChainItem[] = [
      {
        id: 101,
        name: "provider-a",
        reason: "initial_selection",
        selectionMethod: "weighted_random",
        attemptNumber: 1,
      },
    ];

    const selectMock = vi.fn(() =>
      createThenableQuery([{ providerChain: chain }], { whereArgs, orderByArgs, limitArgs })
    );

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findSessionOriginChain } = await import("@/repository/message");
    const result = await findSessionOriginChain("session-happy");

    expect(result).toEqual(chain);
    expect(whereArgs.length).toBeGreaterThan(0);

    const whereSql = sqlToString(whereArgs[0]).toLowerCase();
    expect(whereSql).toContain("warmup");
    expect(whereSql).toContain("is not null");

    expect(orderByArgs.length).toBeGreaterThan(0);
    const orderSql = sqlToString(orderByArgs[0]).toLowerCase();
    expect(orderSql).toContain("request_sequence");
    expect(orderSql).toContain("asc");

    expect(limitArgs).toEqual([1]);
  });

  test("warmup skip: 第一条为 warmup 时应返回后续首条非 warmup 的 chain", async () => {
    vi.resetModules();

    const chain: ProviderChainItem[] = [
      {
        id: 202,
        name: "provider-b",
        reason: "session_reuse",
        selectionMethod: "session_reuse",
        attemptNumber: 2,
      },
    ];

    const selectMock = vi.fn(() => createThenableQuery([{ providerChain: chain }]));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findSessionOriginChain } = await import("@/repository/message");
    const result = await findSessionOriginChain("session-warmup-first");

    expect(result).toEqual(chain);
  });

  test("no data: session 不存在时返回 null", async () => {
    vi.resetModules();

    const selectMock = vi.fn(() => createThenableQuery([]));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findSessionOriginChain } = await import("@/repository/message");
    const result = await findSessionOriginChain("session-not-found");

    expect(result).toBeNull();
  });

  test("all warmup: 全部请求都被 warmup 拦截时返回 null", async () => {
    vi.resetModules();

    const selectMock = vi.fn(() => createThenableQuery([]));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findSessionOriginChain } = await import("@/repository/message");
    const result = await findSessionOriginChain("session-all-warmup");

    expect(result).toBeNull();
  });

  test("null providerChain: 首条非 warmup 记录 providerChain 为空时返回 null", async () => {
    vi.resetModules();

    const selectMock = vi.fn(() => createThenableQuery([]));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findSessionOriginChain } = await import("@/repository/message");
    const result = await findSessionOriginChain("session-null-provider-chain");

    expect(result).toBeNull();
  });
});
