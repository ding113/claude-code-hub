import { describe, expect, test, vi } from "vitest";

function sqlToString(sqlObj: unknown): string {
  const visited = new Set<unknown>();
  const walk = (node: unknown): string => {
    if (!node || visited.has(node)) return "";
    visited.add(node);
    if (typeof node === "string") return node;
    if (typeof node === "object") {
      const anyNode = node as any;
      if (Array.isArray(anyNode)) return anyNode.map(walk).join("");
      if (anyNode.name && typeof anyNode.name === "string") return anyNode.name;
      if (anyNode.value !== undefined) {
        if (Array.isArray(anyNode.value)) return anyNode.value.map(String).join("");
        return String(anyNode.value);
      }
      if (anyNode.queryChunks) return walk(anyNode.queryChunks);
      // Plain object (e.g. a drizzle .set({...}) payload): walk its values.
      return Object.values(anyNode).map(walk).join(" ");
    }
    return "";
  };
  return walk(sqlObj);
}

function mockDbWithWhere(whereImpl: () => Promise<unknown>) {
  const whereArgs: unknown[] = [];
  const setArgs: unknown[] = [];
  const update = vi.fn(() => ({
    set: vi.fn((obj: unknown) => {
      setArgs.push(obj);
      return {
        where: vi.fn((cond: unknown) => {
          whereArgs.push(cond);
          return whereImpl();
        }),
      };
    }),
  }));
  vi.doMock("@/drizzle/db", () => ({
    db: {
      update,
      select: () => ({ from: () => ({ where: async () => [] }) }),
      execute: vi.fn(async () => []),
    },
  }));
  return { update, whereArgs, setArgs };
}

const LOSER = {
  providerId: 2,
  providerName: "p2",
  attemptNumber: 3,
  costUsd: "0.01",
};

describe("addMessageRequestHedgeLoserCost (idempotent + retried direct write)", () => {
  test("成功时只写一次，并带幂等 guard（NOT ... @>）与累加 SQL", async () => {
    vi.resetModules();
    const { update, whereArgs, setArgs } = mockDbWithWhere(async () => []);

    const { addMessageRequestHedgeLoserCost } = await import("@/repository/message");
    await addMessageRequestHedgeLoserCost(1, "0.01", LOSER);

    expect(update).toHaveBeenCalledTimes(1);

    // SET 子句应是对 cost_usd 的累加 + hedge_losers 的追加。
    const setSql = sqlToString(setArgs[0]).toLowerCase();
    expect(setSql).toContain("cost_usd");
    expect(setSql).toContain("hedge_losers");

    // WHERE 子句应包含按 (providerId, attemptNumber) 去重的 jsonb 包含 guard。
    const whereSql = sqlToString(whereArgs[0]).toLowerCase();
    expect(whereSql).toContain("@>");
    expect(whereSql).toContain("hedge_losers");
  });

  test("瞬时失败后重试，最终成功不抛错", async () => {
    vi.resetModules();
    let calls = 0;
    const { update } = mockDbWithWhere(async () => {
      calls++;
      if (calls < 3) throw new Error("transient db error");
      return [];
    });

    const { addMessageRequestHedgeLoserCost } = await import("@/repository/message");
    await expect(addMessageRequestHedgeLoserCost(1, "0.01", LOSER)).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledTimes(3);
  });

  test("持续失败：重试 MAX 次后抛错（让调用方记录，不静默丢失）", async () => {
    vi.resetModules();
    const { update } = mockDbWithWhere(async () => {
      throw new Error("db down");
    });

    const { addMessageRequestHedgeLoserCost } = await import("@/repository/message");
    await expect(addMessageRequestHedgeLoserCost(1, "0.01", LOSER)).rejects.toThrow("db down");
    expect(update).toHaveBeenCalledTimes(3);
  });

  test("非法/零费用（formatCostForStorage 返回 null）时跳过写入", async () => {
    vi.resetModules();
    const { update } = mockDbWithWhere(async () => []);

    const { addMessageRequestHedgeLoserCost } = await import("@/repository/message");
    // 传入无法解析为 Decimal 的值 -> 直接跳过，不写库。
    await addMessageRequestHedgeLoserCost(1, "not-a-number", LOSER);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("updateMessageRequestWinnerCost (direct, idempotent, loser-sum-aware)", () => {
  test("SET 为 winnerCost::numeric + SUM(hedge_losers[].costUsd)，幂等可重试", async () => {
    vi.resetModules();
    const { update, setArgs } = mockDbWithWhere(async () => []);

    const { updateMessageRequestWinnerCost } = await import("@/repository/message");
    await updateMessageRequestWinnerCost(1, "0.1");

    expect(update).toHaveBeenCalledTimes(1);
    const setSql = sqlToString(setArgs[0]).toLowerCase();
    // 赢家费用 + 已落库的输家费用之和（重算式 -> 替换语义 -> 重试安全）。
    expect(setSql).toContain("hedge_losers");
    expect(setSql).toContain("jsonb_array_elements");
    expect(setSql).toContain("sum");
    expect(setSql).toContain("::numeric");
  });

  test("瞬时失败后重试，最终成功不抛错", async () => {
    vi.resetModules();
    let calls = 0;
    const { update } = mockDbWithWhere(async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return [];
    });

    const { updateMessageRequestWinnerCost } = await import("@/repository/message");
    await expect(updateMessageRequestWinnerCost(1, "0.1")).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledTimes(3);
  });
});
