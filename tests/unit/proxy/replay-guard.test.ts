import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyReplayGuard } from "@/app/v1/_lib/proxy/replay/replay-guard";
import {
  deriveReplayIdentity,
  REPLAY_BYPASS_HEADER,
  type ReplayIdentity,
} from "@/app/v1/_lib/proxy/replay/replay-identity";
import type { ReplayMeta } from "@/app/v1/_lib/proxy/replay/replay-store";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

/**
 * F2 replayAttach guard 步骤单测。
 *
 * - identity 用真实 deriveReplayIdentity（env mock 打开 flag），保证 guard 与
 *   identity 的推导一致；
 * - store 通过 mock "@/app/v1/_lib/proxy/replay/replay-store".getReplayStore
 *   注入可控 mock（getMeta/readChunks/findCompleted/tryClaimOwner/deleteChunks）；
 * - 审计行通过 mock "@/drizzle/db" 捕获 messageRequest insert values。
 */

const envControl = vi.hoisted(() => ({
  enableReplay: true,
  liveDedup: true,
}));

const storeControl = vi.hoisted(() => {
  const readChunks = vi.fn(async (): Promise<string[] | null> => null);
  return {
    getMeta: vi.fn(async (): Promise<unknown> => null),
    readChunks,
    readChunksForGeneration: vi.fn(),
    findCompleted: vi.fn(async (): Promise<unknown> => null),
    tryClaimOwner: vi.fn(async (): Promise<boolean> => false),
    prepareOwned: vi.fn(async (): Promise<boolean> => true),
    releaseOwner: vi.fn(async (): Promise<void> => undefined),
    deleteChunks: vi.fn(async (): Promise<void> => undefined),
  };
});

const dbControl = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  insertError: null as Error | null,
  nextId: 501,
}));
const materializeReplayAuditFromSourceMock = vi.hoisted(() => vi.fn());

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
    getEnvConfig: () => ({
      ...baseEnv,
      ENABLE_REQUEST_REPLAY: envControl.enableReplay,
      REPLAY_LIVE_DEDUP_ENABLED: envControl.liveDedup,
    }),
  };
});

vi.mock("@/lib/system-settings/proxy-runtime", () => ({
  // ensure() 每请求刷新一次快照；单测让同步快照为空，isReplayEnabled 走上方 env mock
  getProxyRuntimeSettings: vi.fn(async () => ({
    streamGateMode: "off",
    affinityIgnoreClientSessionId: true,
    replayEnabled: false,
    cacheEffectivenessEnabled: true,
  })),
  getCachedProxyRuntimeSettings: () => null,
}));

vi.mock("@/app/v1/_lib/proxy/replay/replay-store", () => ({
  getReplayStore: () => storeControl,
  resolveReplayTtlSeconds: () => 60,
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        if (dbControl.insertError) throw dbControl.insertError;
        dbControl.rows.push(values);
        return {
          returning: async () => [{ id: dbControl.nextId }],
        };
      },
    }),
  },
}));

vi.mock("@/repository/message", () => ({
  materializeReplayAuditFromSource: materializeReplayAuditFromSourceMock,
}));

interface GuardSessionOverrides {
  message?: Record<string, unknown>;
  headers?: Record<string, string>;
  apiKey?: string | null;
  sessionIdentity?: {
    identity: string;
    kind: "session_id" | "prefix_affinity";
    scopeTag: string | null;
    fingerprint: string | null;
    fingerprints: string[];
  };
}

function makeSession(overrides: GuardSessionOverrides = {}): ProxySession {
  return {
    method: "POST",
    headers: new Headers(overrides.headers ?? {}),
    request: {
      message: overrides.message ?? {
        stream: true,
        model: "claude-sonnet-4",
        messages: [{ role: "user", content: "hi" }],
      },
      model: "claude-sonnet-4",
    },
    authState: {
      key: { id: 11 },
      user: { id: 22 },
      apiKey: "apiKey" in overrides ? overrides.apiKey : "sk-test",
    },
    originalFormat: "claude",
    sessionId: "sess-1",
    userAgent: "vitest-agent",
    replayState: null,
    getEndpointPolicy: () => ({ kind: "default" }),
    getOriginalModel: () => "claude-sonnet-4",
    getEndpoint: () => "/v1/messages",
    getMessagesLength: () => 1,
    getSessionIdentityMetadata: () =>
      overrides.sessionIdentity ?? {
        identity: "sess-1",
        kind: "session_id",
        scopeTag: null,
        fingerprint: null,
        fingerprints: [],
      },
  } as unknown as ProxySession;
}

function expectedIdentity(): ReplayIdentity {
  const identity = deriveReplayIdentity(makeSession());
  if (!identity) throw new Error("test fixture must derive a replay identity");
  return identity;
}

function makeMeta(identity: ReplayIdentity, overrides: Partial<ReplayMeta> = {}): ReplayMeta {
  return {
    status: "owning",
    verifier: identity.verifier,
    scopeTag: identity.scopeTag,
    statusCode: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
    format: "claude",
    model: "claude-sonnet-4",
    chunkCount: 1,
    byteSize: 9,
    heartbeatAt: Date.now(),
    messageRequestId: 202,
    ...overrides,
  };
}

beforeEach(() => {
  envControl.enableReplay = true;
  envControl.liveDedup = true;
  dbControl.rows = [];
  dbControl.insertError = null;
  dbControl.nextId = 501;
  materializeReplayAuditFromSourceMock.mockReset();
  materializeReplayAuditFromSourceMock.mockResolvedValue(true);
  storeControl.readChunksForGeneration.mockImplementation(
    (
      replayId: string,
      _messageRequestId: number,
      fromIndex: number,
      maxCount: number,
      refreshTtlSeconds?: number
    ): Promise<string[] | null | false> =>
      storeControl.readChunks(replayId, fromIndex, maxCount, refreshTtlSeconds)
  );
});

describe("ProxyReplayGuard：放行路径", () => {
  it("功能开关关闭时直接放行，不触碰存储", async () => {
    envControl.enableReplay = false;
    const session = makeSession();

    await expect(ProxyReplayGuard.ensure(session)).resolves.toBeNull();
    expect(storeControl.getMeta).not.toHaveBeenCalled();
    expect(storeControl.tryClaimOwner).not.toHaveBeenCalled();
    expect(session.replayState).toBeNull();
  });

  it("非流式请求不参与 replay", async () => {
    const session = makeSession({ message: { stream: false, model: "claude-sonnet-4" } });

    await expect(ProxyReplayGuard.ensure(session)).resolves.toBeNull();
    expect(storeControl.getMeta).not.toHaveBeenCalled();
  });

  it("Redis miss + PG miss 时放行，claim 成功则清残块后挂 owner 角色", async () => {
    storeControl.tryClaimOwner.mockResolvedValueOnce(true);
    const session = makeSession();
    const identity = expectedIdentity();

    await expect(ProxyReplayGuard.ensure(session)).resolves.toBeNull();

    expect(storeControl.findCompleted).toHaveBeenCalledWith(identity.replayId);
    expect(session.replayState).toMatchObject({
      role: "owner",
      identity: { replayId: identity.replayId, verifier: identity.verifier },
    });
    const ownerToken = session.replayState?.ownerToken;
    expect(typeof ownerToken).toBe("string");
    expect(storeControl.tryClaimOwner).toHaveBeenCalledWith(identity.replayId, ownerToken);
    // PG miss 后以当前 token 原子清旧热层并续租，成功才挂 owner 角色。
    expect(storeControl.prepareOwned).toHaveBeenCalledWith(identity.replayId, ownerToken);
    expect(dbControl.rows).toHaveLength(0);
  });

  it("claim 竞态输掉时不清残块（他人 LIST 不可碰）", async () => {
    storeControl.tryClaimOwner.mockResolvedValueOnce(false);

    await expect(ProxyReplayGuard.ensure(makeSession())).resolves.toBeNull();
    expect(storeControl.prepareOwned).not.toHaveBeenCalled();
  });

  it("buffered owner 不提供 attached_live，竞争请求按 miss 路径 fail-open", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(
      makeMeta(identity, { status: "owning", delivery: "buffered" })
    );

    await expect(ProxyReplayGuard.ensure(makeSession())).resolves.toBeNull();

    expect(storeControl.readChunks).not.toHaveBeenCalled();
    expect(storeControl.findCompleted).not.toHaveBeenCalled();
    expect(storeControl.tryClaimOwner).toHaveBeenCalledWith(identity.replayId, expect.any(String));
    expect(dbControl.rows).toHaveLength(0);
  });

  it("claim 竞态输掉时放行且不带 replay 角色", async () => {
    storeControl.tryClaimOwner.mockResolvedValueOnce(false);
    const session = makeSession();

    await expect(ProxyReplayGuard.ensure(session)).resolves.toBeNull();
    expect(session.replayState).toBeNull();
  });

  it("meta verifier 不符（哈希碰撞）时绝不重放", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(
      makeMeta(identity, { status: "completed", verifier: "f".repeat(32) })
    );
    const session = makeSession();

    await expect(ProxyReplayGuard.ensure(session)).resolves.toBeNull();
    expect(storeControl.readChunks).not.toHaveBeenCalled();
    expect(dbControl.rows).toHaveLength(0);
    expect(storeControl.tryClaimOwner).toHaveBeenCalled();
  });

  it("PG 持久行 verifier 不符时放行", async () => {
    storeControl.findCompleted.mockResolvedValueOnce({
      verifier: "f".repeat(32),
      statusCode: 200,
      headersJson: null,
      payload: "data: x\n\n",
    });

    await expect(ProxyReplayGuard.ensure(makeSession())).resolves.toBeNull();
    expect(dbControl.rows).toHaveLength(0);
  });

  it("aborted 终态条目不可重放", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(makeMeta(identity, { status: "aborted" }));

    await expect(ProxyReplayGuard.ensure(makeSession())).resolves.toBeNull();
    expect(dbControl.rows).toHaveLength(0);
  });

  it("owning 但心跳过期（owner 失联）时不 attach 死流", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(
      makeMeta(identity, { status: "owning", heartbeatAt: Date.now() - 31_000 })
    );

    await expect(ProxyReplayGuard.ensure(makeSession())).resolves.toBeNull();
    expect(dbControl.rows).toHaveLength(0);
  });

  it("owning 但去重开关关闭时不 attach", async () => {
    envControl.liveDedup = false;
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(makeMeta(identity, { status: "owning" }));

    await expect(ProxyReplayGuard.ensure(makeSession())).resolves.toBeNull();
    expect(storeControl.readChunks).not.toHaveBeenCalled();
  });

  it("x-cch-no-replay: 1 跳过 attach（不重放），条目缺失/未完成时仍可成为 owner", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(makeMeta(identity, { status: "owning" }));
    storeControl.tryClaimOwner.mockResolvedValueOnce(true);
    const session = makeSession({ headers: { [REPLAY_BYPASS_HEADER]: "1" } });

    await expect(ProxyReplayGuard.ensure(session)).resolves.toBeNull();
    // 不 attach：不读 chunks、不写审计行
    expect(storeControl.readChunks).not.toHaveBeenCalled();
    expect(dbControl.rows).toHaveLength(0);
    expect(storeControl.tryClaimOwner).toHaveBeenCalledWith(identity.replayId, expect.any(String));
    expect(session.replayState?.role).toBe("owner");
  });

  it("x-cch-no-replay: 1 遇已完成条目（verifier 匹配）：不 claim 不覆写，保留给其他客户端", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(makeMeta(identity, { status: "completed" }));
    const session = makeSession({ headers: { [REPLAY_BYPASS_HEADER]: "1" } });

    await expect(ProxyReplayGuard.ensure(session)).resolves.toBeNull();
    expect(storeControl.tryClaimOwner).not.toHaveBeenCalled();
    expect(storeControl.prepareOwned).not.toHaveBeenCalled();
    expect(session.replayState).toBeNull();
    // 也不重放：照常执行（有意重复采样语义）
    expect(storeControl.readChunks).not.toHaveBeenCalled();
    expect(dbControl.rows).toHaveLength(0);
  });

  it("x-cch-no-replay: 1 遇 completed 但 verifier 不符（哈希碰撞）：不受保护，仍可 claim", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(
      makeMeta(identity, { status: "completed", verifier: "f".repeat(32) })
    );
    storeControl.tryClaimOwner.mockResolvedValueOnce(true);
    const session = makeSession({ headers: { [REPLAY_BYPASS_HEADER]: "1" } });

    await expect(ProxyReplayGuard.ensure(session)).resolves.toBeNull();
    expect(storeControl.tryClaimOwner).toHaveBeenCalledWith(identity.replayId, expect.any(String));
    expect(session.replayState?.role).toBe("owner");
  });

  it("x-cch-no-replay: 1 在 Redis miss 时保护已有 durable winner", async () => {
    const identity = expectedIdentity();
    storeControl.tryClaimOwner.mockResolvedValueOnce(true);
    storeControl.findCompleted.mockResolvedValueOnce({
      verifier: identity.verifier,
      payload: "data: old\n\n",
    });
    const session = makeSession({ headers: { [REPLAY_BYPASS_HEADER]: "1" } });

    await expect(ProxyReplayGuard.ensure(session)).resolves.toBeNull();

    expect(storeControl.tryClaimOwner).toHaveBeenCalledWith(identity.replayId, expect.any(String));
    expect(storeControl.releaseOwner).toHaveBeenCalledWith(identity.replayId, expect.any(String));
    expect(storeControl.prepareOwned).not.toHaveBeenCalled();
    expect(session.replayState).toBeNull();
  });

  it("PG 查询失败时释放刚取得的 owner，不把 unavailable 当成 miss", async () => {
    const identity = expectedIdentity();
    storeControl.tryClaimOwner.mockResolvedValueOnce(true);
    storeControl.findCompleted.mockRejectedValueOnce(new Error("pg down"));
    const session = makeSession();

    await expect(ProxyReplayGuard.ensure(session)).resolves.toBeNull();

    expect(storeControl.releaseOwner).toHaveBeenCalledWith(identity.replayId, expect.any(String));
    expect(storeControl.deleteChunks).not.toHaveBeenCalled();
    expect(session.replayState).toBeNull();
  });

  it("存储异常 fail-open：照常放行", async () => {
    storeControl.getMeta.mockRejectedValueOnce(new Error("redis exploded"));

    await expect(ProxyReplayGuard.ensure(makeSession())).resolves.toBeNull();
  });
});

describe("ProxyReplayGuard：completed 全量重放", () => {
  it("Redis 热层 completed：按固定到期点分页重放，并写审计行", async () => {
    const identity = expectedIdentity();
    let now = Date.now();
    const completedAt = now - 10_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    storeControl.getMeta.mockResolvedValueOnce(
      makeMeta(identity, {
        status: "completed",
        statusCode: 200,
        messageRequestId: 101,
        chunkCount: 65,
        heartbeatAt: completedAt,
      })
    );
    const firstPage = Array.from({ length: 64 }, (_, index) => `data: ${index}\n\n`);
    storeControl.readChunks
      .mockImplementationOnce(async () => {
        now += 30_000;
        return firstPage;
      })
      .mockResolvedValueOnce(["data: tail\n\n"]);
    const session = makeSession({
      sessionIdentity: {
        identity: "pfx:scope:current",
        kind: "prefix_affinity",
        scopeTag: "scope",
        fingerprint: "current",
        fingerprints: ["current", "parent"],
      },
    });

    try {
      const response = await ProxyReplayGuard.ensure(session);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
      expect(response?.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
      expect(response?.headers.get("cache-control")).toBe("no-cache");
      expect(response?.headers.get("x-cch-replay")).toBe("completed");
      await expect(response?.text()).resolves.toBe(`${firstPage.join("")}data: tail\n\n`);

      expect(storeControl.readChunks).toHaveBeenNthCalledWith(1, identity.replayId, 0, 64, 50);
      expect(storeControl.readChunks).toHaveBeenNthCalledWith(2, identity.replayId, 64, 1, 20);
      expect(storeControl.tryClaimOwner).not.toHaveBeenCalled();

      expect(dbControl.rows).toHaveLength(1);
      expect(dbControl.rows[0]).toMatchObject({
        providerId: 0,
        userId: 22,
        key: "sk-test",
        model: "claude-sonnet-4",
        sessionId: "sess-1",
        sessionIdentity: "pfx:scope:current",
        sessionIdentityKind: "prefix_affinity",
        affinityScopeTag: "scope",
        affinityFingerprint: "current",
        affinityFingerprintChain: ["current", "parent"],
        statusCode: 200,
        costUsd: "0",
        blockedBy: null,
        isReplay: true,
        replaySourceRequestId: 101,
        endpoint: "/v1/messages",
        messagesCount: 1,
        userAgent: "vitest-agent",
      });
      expect(String(dbControl.rows[0].blockedReason)).toContain("redis_completed");
      expect(String(dbControl.rows[0].blockedReason)).toContain(identity.replayId.slice(0, 12));
      expect(materializeReplayAuditFromSourceMock).toHaveBeenCalledWith(501, 101);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("completed JSON 恢复语义 headers 和原始 body，不注入 SSE headers", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(
      makeMeta(identity, {
        status: "completed",
        statusCode: 201,
        delivery: "buffered",
        headers: {
          connection: "keep-alive",
          "content-length": "999",
          "content-type": "application/json; charset=utf-8",
          "cache-control": "private, max-age=30",
          "x-provider-request-id": "req-json",
        },
      })
    );
    storeControl.readChunks.mockResolvedValueOnce(['{"id":"resp_1","status":"completed"}']);

    const response = await ProxyReplayGuard.ensure(makeSession());

    expect(response?.status).toBe(201);
    expect(response?.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response?.headers.get("cache-control")).toBe("private, max-age=30");
    expect(response?.headers.get("x-provider-request-id")).toBe("req-json");
    expect(response?.headers.get("connection")).toBeNull();
    expect(response?.headers.get("content-length")).toBeNull();
    expect(response?.headers.get("x-cch-replay")).toBe("completed");
    await expect(response?.text()).resolves.toBe('{"id":"resp_1","status":"completed"}');
  });

  it("热层块已过期时落 PG 持久层重放", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(makeMeta(identity, { status: "completed" }));
    storeControl.readChunks.mockResolvedValueOnce([]);
    storeControl.findCompleted.mockResolvedValueOnce({
      verifier: identity.verifier,
      statusCode: 200,
      headersJson: { "content-type": "text/event-stream" },
      payload: "data: pg\n\n",
      sourceMessageRequestId: 102,
    });

    const response = await ProxyReplayGuard.ensure(makeSession());

    expect(response?.headers.get("x-cch-replay")).toBe("completed");
    await expect(response?.text()).resolves.toBe("data: pg\n\n");
    expect(String(dbControl.rows[0].blockedReason)).toContain("pg_completed");
  });

  it("慢客户端读取下一页时 Redis 过期，从同一 durable payload 精确续传", async () => {
    const identity = expectedIdentity();
    const firstPage = Array.from({ length: 64 }, (_, index) => `part-${index}|`);
    const durablePayload = `${firstPage.join("")}tail`;
    storeControl.getMeta.mockResolvedValueOnce(
      makeMeta(identity, { status: "completed", chunkCount: 65 })
    );
    storeControl.readChunks.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([]);
    storeControl.findCompleted.mockResolvedValueOnce({
      verifier: identity.verifier,
      sourceMessageRequestId: 202,
      payload: durablePayload,
    });

    const response = await ProxyReplayGuard.ensure(makeSession());

    await expect(response?.text()).resolves.toBe(durablePayload);
    expect(storeControl.findCompleted).toHaveBeenCalledWith(identity.replayId);
    expect(storeControl.readChunks).toHaveBeenNthCalledWith(2, identity.replayId, 64, 1, 60);
  });

  it("Redis 中途过期时拒绝使用 verifier 不匹配的 durable payload", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(
      makeMeta(identity, { status: "completed", chunkCount: 2 })
    );
    storeControl.readChunks.mockResolvedValueOnce(["prefix"]).mockResolvedValueOnce([]);
    storeControl.findCompleted.mockResolvedValueOnce({
      verifier: "f".repeat(32),
      payload: "prefixforeign",
    });

    const response = await ProxyReplayGuard.ensure(makeSession());

    await expect(response?.text()).rejects.toThrow("replay completed payload was truncated");
  });

  it("Redis 全 miss 时 PG 持久层直接命中；headersJson 缺失回退 SSE 头", async () => {
    const identity = expectedIdentity();
    storeControl.findCompleted.mockResolvedValueOnce({
      verifier: identity.verifier,
      statusCode: 201,
      headersJson: null,
      payload: "data: durable\n\n",
      sourceMessageRequestId: 103,
    });

    const response = await ProxyReplayGuard.ensure(makeSession());

    expect(response?.status).toBe(201);
    expect(response?.headers.get("content-type")).toBe("text/event-stream");
    await expect(response?.text()).resolves.toBe("data: durable\n\n");
    expect(dbControl.rows[0]).toMatchObject({
      statusCode: 201,
      blockedBy: null,
      isReplay: true,
      replaySourceRequestId: 103,
    });
    expect(materializeReplayAuditFromSourceMock).toHaveBeenCalledWith(501, 103);
  });

  it("审计行写失败不影响重放响应", async () => {
    const identity = expectedIdentity();
    dbControl.insertError = new Error("pg down");
    storeControl.getMeta.mockResolvedValueOnce(makeMeta(identity, { status: "completed" }));
    storeControl.readChunks.mockResolvedValueOnce(["data: a\n\n"]);

    const response = await ProxyReplayGuard.ensure(makeSession());
    expect(response).not.toBeNull();
    await expect(response?.text()).resolves.toBe("data: a\n\n");
  });

  it("缺认证上下文（apiKey 为空）时跳过审计行但仍重放", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(makeMeta(identity, { status: "completed" }));
    storeControl.readChunks.mockResolvedValueOnce(["data: a\n\n"]);

    const response = await ProxyReplayGuard.ensure(makeSession({ apiKey: null }));
    expect(response).not.toBeNull();
    expect(dbControl.rows).toHaveLength(0);
  });
});

describe("ProxyReplayGuard：owning attach-live 跟尾", () => {
  it("先吐已缓存前缀，轮询跟尾直到 completed 收尾", async () => {
    const identity = expectedIdentity();
    const completed = makeMeta(identity, {
      status: "completed",
      messageRequestId: 202,
      chunkCount: 2,
    });
    const metaSequence: ReplayMeta[] = [makeMeta(identity, { status: "owning" })];
    storeControl.getMeta.mockImplementation(async () => metaSequence.shift() ?? completed);

    // pull 循环时序：(0)->前缀["a"]；(1)->[] 触发 meta 查询得 completed；
    // completed.chunkCount 精确约束最后一块，消费完即收尾。
    const chunkSequence: string[][] = [["data: a\n\n"], [], ["data: b\n\n"]];
    storeControl.readChunks.mockImplementation(async () => chunkSequence.shift() ?? []);

    const response = await ProxyReplayGuard.ensure(makeSession());

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(response?.headers.get("x-cch-replay")).toBe("live");
    await expect(response?.text()).resolves.toBe("data: a\n\ndata: b\n\n");

    expect(dbControl.rows).toHaveLength(1);
    expect(dbControl.rows[0]).toMatchObject({
      blockedBy: null,
      costUsd: "0",
      providerId: 0,
      isReplay: true,
    });
    expect(String(dbControl.rows[0].blockedReason)).toContain("attached_live");
    expect(materializeReplayAuditFromSourceMock).toHaveBeenCalledWith(501, 202);
    expect(storeControl.tryClaimOwner).not.toHaveBeenCalled();
  });

  it("completed 元数据声明的尾块缺失时终止流而不是伪装完整", async () => {
    const identity = expectedIdentity();
    const completed = makeMeta(identity, { status: "completed", chunkCount: 2 });
    const metaSequence: ReplayMeta[] = [makeMeta(identity, { status: "owning" })];
    storeControl.getMeta.mockImplementation(async () => metaSequence.shift() ?? completed);
    const chunkSequence: string[][] = [["data: a\n\n"], [], []];
    storeControl.readChunks.mockImplementation(async () => chunkSequence.shift() ?? []);

    const response = await ProxyReplayGuard.ensure(makeSession());

    await expect(response?.text()).rejects.toThrow("replay live payload was truncated");
    expect(dbControl.rows).toHaveLength(0);
  });

  it("live attach 转为 completed 后热层过期时从 durable payload 精确续传", async () => {
    const identity = expectedIdentity();
    const completed = makeMeta(identity, {
      status: "completed",
      messageRequestId: 203,
      chunkCount: 2,
    });
    const metaSequence: ReplayMeta[] = [
      makeMeta(identity, { status: "owning", messageRequestId: 203 }),
    ];
    storeControl.getMeta.mockImplementation(async () => metaSequence.shift() ?? completed);
    const chunkSequence: string[][] = [["data: a\n\n"], [], []];
    storeControl.readChunks.mockImplementation(async () => chunkSequence.shift() ?? []);
    storeControl.findCompleted.mockResolvedValueOnce({
      verifier: identity.verifier,
      sourceMessageRequestId: 203,
      payload: "data: a\n\ndata: b\n\n",
    });

    const response = await ProxyReplayGuard.ensure(makeSession());

    await expect(response?.text()).resolves.toBe("data: a\n\ndata: b\n\n");
    expect(storeControl.findCompleted).toHaveBeenCalledWith(identity.replayId);
    expect(dbControl.rows).toHaveLength(1);
    expect(String(dbControl.rows[0].blockedReason)).toContain("attached_live");
  });

  it("live attach 未观察到 completed meta 时仍从 durable payload 精确续传", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta
      .mockResolvedValueOnce(makeMeta(identity, { status: "owning", messageRequestId: 204 }))
      .mockResolvedValueOnce(null);
    const chunkSequence: string[][] = [["data: a\n\n"], []];
    storeControl.readChunks.mockImplementation(async () => chunkSequence.shift() ?? []);
    storeControl.findCompleted.mockResolvedValueOnce({
      verifier: identity.verifier,
      statusCode: 200,
      sourceMessageRequestId: 204,
      payload: "data: a\n\ndata: b\n\n",
    });

    const response = await ProxyReplayGuard.ensure(makeSession());

    await expect(response?.text()).resolves.toBe("data: a\n\ndata: b\n\n");
    expect(storeControl.findCompleted).toHaveBeenCalledWith(identity.replayId);
    expect(materializeReplayAuditFromSourceMock).toHaveBeenCalledWith(501, 204);
    expect(dbControl.rows).toHaveLength(1);
    expect(String(dbControl.rows[0].blockedReason)).toContain("attached_live");
  });

  it("live attach 未观察到 completed meta 时拒绝拼接旧 owner 的 durable payload", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta
      .mockResolvedValueOnce(makeMeta(identity, { status: "owning", messageRequestId: 205 }))
      .mockResolvedValueOnce(null);
    const chunkSequence: string[][] = [["data: new-prefix\n\n"], []];
    storeControl.readChunks.mockImplementation(async () => chunkSequence.shift() ?? []);
    storeControl.findCompleted.mockResolvedValueOnce({
      verifier: identity.verifier,
      statusCode: 200,
      sourceMessageRequestId: 199,
      payload: "data: old-prefix\n\ndata: old-tail\n\n",
    });

    const response = await ProxyReplayGuard.ensure(makeSession());

    await expect(response?.text()).rejects.toThrow("replay source aborted");
    expect(dbControl.rows).toHaveLength(0);
  });

  it("live attach 已观察 completed meta 后仍拒绝拼接另一代 durable payload", async () => {
    const identity = expectedIdentity();
    const completed = makeMeta(identity, {
      status: "completed",
      messageRequestId: 206,
      chunkCount: 2,
    });
    const metaSequence: ReplayMeta[] = [
      makeMeta(identity, { status: "owning", messageRequestId: 206 }),
    ];
    storeControl.getMeta.mockImplementation(async () => metaSequence.shift() ?? completed);
    const chunkSequence: string[][] = [["data: new-prefix\n\n"], [], []];
    storeControl.readChunks.mockImplementation(async () => chunkSequence.shift() ?? []);
    storeControl.findCompleted.mockResolvedValueOnce({
      verifier: identity.verifier,
      sourceMessageRequestId: 199,
      payload: "data: old-prefix\n\ndata: old-tail\n\n",
    });

    const response = await ProxyReplayGuard.ensure(makeSession());

    await expect(response?.text()).rejects.toThrow("replay live payload was truncated");
    expect(dbControl.rows).toHaveLength(0);
  });

  it("live attach 原子读取发现 owner 已换代时立即终止", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(
      makeMeta(identity, { status: "owning", messageRequestId: 207 })
    );
    storeControl.readChunksForGeneration.mockResolvedValueOnce(false);

    const response = await ProxyReplayGuard.ensure(makeSession());

    await expect(response?.text()).rejects.toThrow("replay owner generation changed");
    expect(storeControl.findCompleted).not.toHaveBeenCalled();
    expect(dbControl.rows).toHaveLength(0);
  });

  it("live attach 原子读取发现 meta 已过期时仍可从同代 durable 续传", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(
      makeMeta(identity, { status: "owning", messageRequestId: 208 })
    );
    storeControl.readChunksForGeneration.mockResolvedValueOnce([]);
    storeControl.getMeta.mockResolvedValueOnce(null);
    storeControl.findCompleted.mockResolvedValueOnce({
      verifier: identity.verifier,
      statusCode: 200,
      sourceMessageRequestId: 208,
      payload: "data: durable\n\n",
    });

    const response = await ProxyReplayGuard.ensure(makeSession());

    await expect(response?.text()).resolves.toBe("data: durable\n\n");
    expect(dbControl.rows).toHaveLength(1);
  });

  it("attach 中 Redis 失联按传输错误终止流", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(makeMeta(identity, { status: "owning" }));
    storeControl.readChunks.mockResolvedValueOnce(null);

    const response = await ProxyReplayGuard.ensure(makeSession());

    expect(response).not.toBeNull();
    await expect(response?.text()).rejects.toThrow("replay attach lost redis connection");
    expect(dbControl.rows).toHaveLength(0);
  });

  it("attach 中源条目转为 aborted 时终止流", async () => {
    const identity = expectedIdentity();
    const metaSequence: ReplayMeta[] = [
      makeMeta(identity, { status: "owning" }),
      makeMeta(identity, { status: "aborted" }),
    ];
    storeControl.getMeta.mockImplementation(
      async () => metaSequence.shift() ?? makeMeta(identity, { status: "aborted" })
    );
    storeControl.readChunks.mockResolvedValue([]);

    const response = await ProxyReplayGuard.ensure(makeSession());

    expect(response).not.toBeNull();
    await expect(response?.text()).rejects.toThrow("replay source aborted");
    expect(dbControl.rows).toHaveLength(0);
  });

  it("client cancel stops live Replay polling and does not create a delivery audit", async () => {
    const identity = expectedIdentity();
    const owning = makeMeta(identity, { status: "owning" });
    const completed = makeMeta(identity, { status: "completed", messageRequestId: 202 });
    let resolveTerminal: ((meta: ReplayMeta) => void) | null = null;
    storeControl.getMeta.mockResolvedValueOnce(owning).mockImplementationOnce(
      () =>
        new Promise<ReplayMeta>((resolve) => {
          resolveTerminal = resolve;
        })
    );
    storeControl.readChunks.mockResolvedValue([]);

    const response = await ProxyReplayGuard.ensure(makeSession());
    const reader = response?.body?.getReader();
    const pendingRead = reader?.read();
    await vi.waitFor(() => expect(resolveTerminal).not.toBeNull());
    const cancelPromise = reader?.cancel();
    resolveTerminal?.(completed);
    await cancelPromise;
    await pendingRead;
    await Promise.resolve();

    expect(materializeReplayAuditFromSourceMock).not.toHaveBeenCalled();
    expect(dbControl.rows).toHaveLength(0);
  });

  it("client cancel during a Redis page read prevents every later pull and audit", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(makeMeta(identity, { status: "owning" }));
    let resolveRead: ((chunks: string[]) => void) | null = null;
    storeControl.readChunks.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveRead = resolve;
        })
    );

    const response = await ProxyReplayGuard.ensure(makeSession());
    const reader = response?.body?.getReader();
    const pendingRead = reader?.read();
    await vi.waitFor(() => expect(resolveRead).not.toBeNull());

    await reader?.cancel();
    resolveRead?.(["data: late\n\n"]);
    await pendingRead;
    await Promise.resolve();

    expect(storeControl.readChunks).toHaveBeenCalledTimes(1);
    expect(storeControl.getMeta).toHaveBeenCalledTimes(1);
    expect(materializeReplayAuditFromSourceMock).not.toHaveBeenCalled();
    expect(dbControl.rows).toHaveLength(0);
  });
});
