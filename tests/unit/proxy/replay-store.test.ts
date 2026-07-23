import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getReplayStore,
  type ReplayMeta,
  type ReplayPersistedRow,
  ReplayStore,
  resolveReplayTtlSeconds,
} from "@/app/v1/_lib/proxy/replay/replay-store";

/**
 * F2 Replay 双层存储单测。
 *
 * - Redis 热层：mock "@/lib/redis/client".getRedisClient 注入内存版 fake client
 *   （Map 实现 KV/LIST/NX/XX/compare-delete 语义），或 null 验证 fail-open。
 * - PG 完成层：mock "@/drizzle/db"，捕获 insert values 与 where 条件，
 *   用 PgDialect.sqlToQuery 断言过期过滤 SQL。
 */

const envControl = vi.hoisted(() => ({
  shouldThrow: false,
  replayTtlSeconds: 600,
  completedTtlSeconds: 3600,
}));

const redisControl = vi.hoisted(() => ({
  client: null as unknown,
}));

const dbState = vi.hoisted(() => ({
  insertValues: [] as Record<string, unknown>[],
  onConflictCalls: 0,
  deleteWheres: [] as unknown[],
  selectWheres: [] as unknown[],
  selectRows: [] as Record<string, unknown>[],
  insertError: null as Error | null,
  selectError: null as Error | null,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/lib/config/env.schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/env.schema")>();
  const baseEnv = actual.EnvSchema.parse({});
  return {
    ...actual,
    getEnvConfig: () => {
      if (envControl.shouldThrow) throw new Error("env unavailable");
      return {
        ...baseEnv,
        REPLAY_TTL_SECONDS: envControl.replayTtlSeconds,
        REPLAY_COMPLETED_TTL_SECONDS: envControl.completedTtlSeconds,
      };
    },
  };
});

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: () => redisControl.client,
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        if (dbState.insertError) throw dbState.insertError;
        dbState.insertValues.push(values);
        return {
          onConflictDoNothing: async () => {
            dbState.onConflictCalls += 1;
          },
        };
      },
    }),
    delete: () => ({
      where: (condition: unknown) => {
        dbState.deleteWheres.push(condition);
        return { returning: async () => [] as { replayId: string }[] };
      },
    }),
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          dbState.selectWheres.push(condition);
          return {
            limit: async () => {
              if (dbState.selectError) throw dbState.selectError;
              return dbState.selectRows;
            },
          };
        },
      }),
    }),
  },
}));

function createFakeRedis() {
  const kv = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const listTtls = new Map<string, number>();
  return {
    status: "ready",
    kv,
    lists,
    listTtls,
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      kv.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key: string) => kv.get(key) ?? null),
    del: vi.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (kv.delete(key)) deleted += 1;
        if (lists.delete(key)) deleted += 1;
      }
      return deleted;
    }),
    set: vi.fn(async (key: string, value: string, ...args: (string | number)[]) => {
      const flags = args.filter((arg): arg is string => typeof arg === "string");
      const exists = kv.has(key);
      if (flags.includes("NX") && exists) return null;
      if (flags.includes("XX") && !exists) return null;
      kv.set(key, value);
      return "OK";
    }),
    // 按脚本内容分发：RPUSH+EXPIRE（list 追加）/ compare-expire（续租）/ compare-delete（释放）
    eval: vi.fn(
      async (script: string, _numkeys: number, key: string, ...args: (string | number)[]) => {
        if (script.includes("RPUSH")) {
          const [ttl, ...values] = args;
          const list = lists.get(key) ?? [];
          list.push(...values.map(String));
          lists.set(key, list);
          if (Number(ttl) > 0) listTtls.set(key, Number(ttl));
          return list.length;
        }
        const token = args[0] as string;
        if (script.includes("EXPIRE")) {
          return kv.get(key) === token ? 1 : 0;
        }
        if (kv.get(key) === token) {
          kv.delete(key);
          return 1;
        }
        return 0;
      }
    ),
    lrange: vi.fn(async (key: string, start: number, stop: number) => {
      const list = lists.get(key) ?? [];
      return stop === -1 ? list.slice(start) : list.slice(start, stop + 1);
    }),
    llen: vi.fn(async (key: string) => (lists.get(key) ?? []).length),
    expire: vi.fn(async () => 1),
  };
}

type FakeRedis = ReturnType<typeof createFakeRedis>;

function makeMeta(overrides: Partial<ReplayMeta> = {}): ReplayMeta {
  return {
    status: "owning",
    verifier: "vf".repeat(16),
    scopeTag: "st".repeat(8),
    statusCode: 200,
    headers: { "content-type": "text/event-stream" },
    format: "claude",
    model: "claude-sonnet-4",
    chunkCount: 0,
    byteSize: 0,
    heartbeatAt: Date.now(),
    ...overrides,
  };
}

function makePersistedRow(overrides: Partial<ReplayPersistedRow> = {}): ReplayPersistedRow {
  return {
    replayId: "r1".repeat(16),
    verifier: "vf".repeat(16),
    scopeTag: "st".repeat(8),
    keyId: 11,
    userId: 22,
    format: "claude",
    model: "claude-sonnet-4",
    statusCode: 200,
    headers: { "content-type": "text/event-stream" },
    payload: "data: hello\n\n",
    byteSize: 13,
    sourceMessageRequestId: 77,
    ...overrides,
  };
}

const dialect = new PgDialect();

function toSqlText(condition: unknown): string {
  return dialect.sqlToQuery(condition as SQL).sql;
}

beforeEach(() => {
  envControl.shouldThrow = false;
  envControl.replayTtlSeconds = 600;
  envControl.completedTtlSeconds = 3600;
  redisControl.client = createFakeRedis();
  dbState.insertValues = [];
  dbState.onConflictCalls = 0;
  dbState.deleteWheres = [];
  dbState.selectWheres = [];
  dbState.selectRows = [];
  dbState.insertError = null;
  dbState.selectError = null;
});

function currentRedis(): FakeRedis {
  return redisControl.client as FakeRedis;
}

describe("ReplayStore：Redis 不可用时全部 fail-open", () => {
  it("client 为 null 时读 miss、写放弃、claim 失败，均不抛", async () => {
    redisControl.client = null;
    const store = new ReplayStore();

    await expect(store.getMeta("r1")).resolves.toBeNull();
    await expect(store.setMeta("r1", makeMeta())).resolves.toBe(false);
    await expect(store.appendChunks("r1", ["a"])).resolves.toBeNull();
    await expect(store.readChunks("r1", 0)).resolves.toBeNull();
    await expect(store.tryClaimOwner("r1", "tok")).resolves.toBe(false);
    // 续租时 Redis 不可用 = 状态未知：返回 true 不惩罚正在冲刷的 owner
    await expect(store.renewOwnerLease("r1", "tok")).resolves.toBe(true);
    await expect(store.releaseOwner("r1", "tok")).resolves.toBeUndefined();
    await expect(store.deleteEntry("r1")).resolves.toBeUndefined();
    await expect(store.deleteChunks("r1")).resolves.toBeUndefined();
  });

  it("client 未 ready 时同样 fail-open 且不发命令", async () => {
    const fake = createFakeRedis();
    fake.status = "connecting";
    redisControl.client = fake;
    const store = new ReplayStore();

    await expect(store.getMeta("r1")).resolves.toBeNull();
    await expect(store.tryClaimOwner("r1", "tok")).resolves.toBe(false);
    expect(fake.get).not.toHaveBeenCalled();
    expect(fake.set).not.toHaveBeenCalled();
  });

  it("Redis 命令抛错时租约方法吞掉异常", async () => {
    const fake = currentRedis();
    fake.set.mockRejectedValue(new Error("boom"));
    fake.eval.mockRejectedValue(new Error("boom"));
    const store = new ReplayStore();

    await expect(store.tryClaimOwner("r1", "tok")).resolves.toBe(false);
    // 续租异常保守视为所有权已失
    await expect(store.renewOwnerLease("r1", "tok")).resolves.toBe(false);
    await expect(store.releaseOwner("r1", "tok")).resolves.toBeUndefined();
  });
});

describe("ReplayStore：meta 状态机（Redis 热层）", () => {
  it("setMeta/getMeta roundtrip，key 带前缀且 TTL 取 REPLAY_TTL_SECONDS", async () => {
    envControl.replayTtlSeconds = 123;
    const store = new ReplayStore();
    const meta = makeMeta();

    await expect(store.setMeta("r1", meta)).resolves.toBe(true);
    expect(currentRedis().setex).toHaveBeenCalledWith(
      "cch:replay:meta:r1",
      123,
      JSON.stringify(meta)
    );
    await expect(store.getMeta("r1")).resolves.toEqual(meta);
  });

  it("setMeta 支持显式 ttlSeconds 覆盖", async () => {
    const store = new ReplayStore();
    await store.setMeta("r1", makeMeta(), 45);
    expect(currentRedis().setex).toHaveBeenCalledWith("cch:replay:meta:r1", 45, expect.any(String));
  });

  it("owning -> completed 状态迁移", async () => {
    const store = new ReplayStore();
    await store.setMeta("r1", makeMeta({ status: "owning" }));
    await store.setMeta("r1", makeMeta({ status: "completed", chunkCount: 3 }));

    const meta = await store.getMeta("r1");
    expect(meta?.status).toBe("completed");
    expect(meta?.chunkCount).toBe(3);
  });

  it("owning -> aborted 状态迁移", async () => {
    const store = new ReplayStore();
    await store.setMeta("r1", makeMeta({ status: "owning" }));
    await store.setMeta("r1", makeMeta({ status: "aborted", abortReason: "upstream_error" }));

    const meta = await store.getMeta("r1");
    expect(meta?.status).toBe("aborted");
    expect(meta?.abortReason).toBe("upstream_error");
  });

  it("deleteEntry 同时删除 meta 与 chunks", async () => {
    const store = new ReplayStore();
    await store.setMeta("r1", makeMeta());
    await store.appendChunks("r1", ["a", "b"]);

    await store.deleteEntry("r1");

    await expect(store.getMeta("r1")).resolves.toBeNull();
    await expect(store.readChunks("r1", 0)).resolves.toEqual([]);
  });
});

describe("ReplayStore：chunks 热层", () => {
  it("appendChunks 单条 Lua 原子追加返回累计长度并续期，readChunks 支持 offset 跟尾", async () => {
    envControl.replayTtlSeconds = 300;
    const store = new ReplayStore();

    await expect(store.appendChunks("r1", ["a", "b"])).resolves.toBe(2);
    await expect(store.appendChunks("r1", ["c"])).resolves.toBe(3);
    expect(currentRedis().eval).toHaveBeenCalledWith(
      expect.stringContaining("RPUSH"),
      1,
      "cch:replay:chunks:r1",
      300,
      "a",
      "b"
    );
    expect(currentRedis().listTtls.get("cch:replay:chunks:r1")).toBe(300);

    await expect(store.readChunks("r1", 0)).resolves.toEqual(["a", "b", "c"]);
    await expect(store.readChunks("r1", 2)).resolves.toEqual(["c"]);
    await expect(store.readChunks("r1", 3)).resolves.toEqual([]);
  });
});

describe("ReplayStore：owner 租约", () => {
  it("tryClaimOwner 走 SET NX EX 语义，首个 claim 成功、并发第二个失败", async () => {
    const store = new ReplayStore();

    await expect(store.tryClaimOwner("r1", "tok-a")).resolves.toBe(true);
    expect(currentRedis().set).toHaveBeenCalledWith("cch:replay:owner:r1", "tok-a", "EX", 45, "NX");
    await expect(store.tryClaimOwner("r1", "tok-b")).resolves.toBe(false);
    expect(currentRedis().kv.get("cch:replay:owner:r1")).toBe("tok-a");
  });

  it("renewOwnerLease 是 compare-and-expire：token 仍属自己时续期返回 true", async () => {
    const store = new ReplayStore();
    await store.tryClaimOwner("r1", "tok-a");

    await expect(store.renewOwnerLease("r1", "tok-a")).resolves.toBe(true);
    expect(currentRedis().eval).toHaveBeenLastCalledWith(
      expect.stringContaining("EXPIRE"),
      1,
      "cch:replay:owner:r1",
      "tok-a",
      45
    );
    expect(currentRedis().kv.get("cch:replay:owner:r1")).toBe("tok-a");
  });

  it("renewOwnerLease 在租约不存在或已被接管时返回 false，且绝不覆写他人租约", async () => {
    const store = new ReplayStore();

    await expect(store.renewOwnerLease("r1", "tok-a")).resolves.toBe(false);
    expect(currentRedis().kv.has("cch:replay:owner:r1")).toBe(false);

    await store.tryClaimOwner("r1", "tok-b");
    await expect(store.renewOwnerLease("r1", "tok-a")).resolves.toBe(false);
    expect(currentRedis().kv.get("cch:replay:owner:r1")).toBe("tok-b");
  });

  it("releaseOwner 是 compare-delete：token 不匹配不删，匹配才删", async () => {
    const store = new ReplayStore();
    await store.tryClaimOwner("r1", "tok-a");

    await store.releaseOwner("r1", "tok-other");
    expect(currentRedis().kv.get("cch:replay:owner:r1")).toBe("tok-a");

    await store.releaseOwner("r1", "tok-a");
    expect(currentRedis().kv.has("cch:replay:owner:r1")).toBe(false);
    await expect(store.tryClaimOwner("r1", "tok-b")).resolves.toBe(true);
  });
});

describe("ReplayStore：PG 完成持久层", () => {
  it("persistCompleted 写入行（expiresAt = now + REPLAY_COMPLETED_TTL_SECONDS），写路径不顺带清理", async () => {
    envControl.completedTtlSeconds = 1000;
    const store = new ReplayStore();
    const row = makePersistedRow();

    const before = Date.now();
    await store.persistCompleted(row);
    const after = Date.now();

    expect(dbState.insertValues).toHaveLength(1);
    const inserted = dbState.insertValues[0];
    expect(inserted).toMatchObject({
      replayId: row.replayId,
      verifier: row.verifier,
      scopeTag: row.scopeTag,
      keyId: 11,
      userId: 22,
      format: "claude",
      model: "claude-sonnet-4",
      statusCode: 200,
      headersJson: row.headers,
      payload: row.payload,
      byteSize: 13,
      sourceMessageRequestId: 77,
    });
    const expiresAt = (inserted.expiresAt as Date).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 1000 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 1000 * 1000);
    expect(dbState.onConflictCalls).toBe(1);

    // 过期行清理只归定时调度器：写路径不做机会式扫尾
    expect(dbState.deleteWheres).toHaveLength(0);
  });

  it("persistCompleted 遇 PG 异常必须抛出（complete 屏障依赖异常走 abort）", async () => {
    dbState.insertError = new Error("pg down");
    const store = new ReplayStore();

    await expect(store.persistCompleted(makePersistedRow())).rejects.toThrow("pg down");
  });

  it("cleanupExpired 删除过期行（供定时调度器调用）", async () => {
    const store = new ReplayStore();
    await expect(store.cleanupExpired()).resolves.toBe(0);

    expect(dbState.deleteWheres).toHaveLength(1);
    const deleteSql = toSqlText(dbState.deleteWheres[0]);
    expect(deleteSql).toContain('"expires_at" <');
  });

  it("findCompleted 只按 replayId + 未过期条件查询并返回首行", async () => {
    const persisted = { replayId: "r1", verifier: "vf", payload: "data: x\n\n" };
    dbState.selectRows = [persisted];
    const store = new ReplayStore();

    await expect(store.findCompleted("r1")).resolves.toEqual(persisted);
    expect(dbState.selectWheres).toHaveLength(1);
    const whereSql = toSqlText(dbState.selectWheres[0]);
    expect(whereSql).toContain('"replay_id" =');
    expect(whereSql).toContain('"expires_at" >');
  });

  it("findCompleted 无行返回 null，PG 异常也返回 null", async () => {
    const store = new ReplayStore();
    await expect(store.findCompleted("r1")).resolves.toBeNull();

    dbState.selectError = new Error("pg down");
    await expect(store.findCompleted("r1")).resolves.toBeNull();
  });
});

describe("resolveReplayTtlSeconds / getReplayStore", () => {
  it("读 env 的 REPLAY_TTL_SECONDS", () => {
    envControl.replayTtlSeconds = 1234;
    expect(resolveReplayTtlSeconds()).toBe(1234);
  });

  it("env 不可用时回退 600", () => {
    envControl.shouldThrow = true;
    expect(resolveReplayTtlSeconds()).toBe(600);
  });

  it("getReplayStore 返回共享单例", () => {
    const first = getReplayStore();
    expect(getReplayStore()).toBe(first);
    expect(first).toBeInstanceOf(ReplayStore);
  });
});
