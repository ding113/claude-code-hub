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
 *   注入可控 mock（getMeta/readChunks/findCompleted/tryClaimOwner）；
 * - 审计行通过 mock "@/drizzle/db" 捕获 messageRequest insert values。
 */

const envControl = vi.hoisted(() => ({
  enableReplay: true,
  liveDedup: true,
}));

const storeControl = vi.hoisted(() => ({
  getMeta: vi.fn(async (): Promise<unknown> => null),
  readChunks: vi.fn(async (): Promise<string[] | null> => null),
  findCompleted: vi.fn(async (): Promise<unknown> => null),
  tryClaimOwner: vi.fn(async (): Promise<boolean> => false),
}));

const dbControl = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  insertError: null as Error | null,
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
    getEnvConfig: () => ({
      ...baseEnv,
      ENABLE_REQUEST_REPLAY: envControl.enableReplay,
      REPLAY_LIVE_DEDUP_ENABLED: envControl.liveDedup,
    }),
  };
});

vi.mock("@/app/v1/_lib/proxy/replay/replay-store", () => ({
  getReplayStore: () => storeControl,
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        if (dbControl.insertError) throw dbControl.insertError;
        dbControl.rows.push(values);
      },
    }),
  },
}));

interface GuardSessionOverrides {
  message?: Record<string, unknown>;
  headers?: Record<string, string>;
  apiKey?: string | null;
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
    ...overrides,
  };
}

beforeEach(() => {
  envControl.enableReplay = true;
  envControl.liveDedup = true;
  dbControl.rows = [];
  dbControl.insertError = null;
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

  it("Redis miss + PG miss 时放行，claim 成功则挂 owner 角色", async () => {
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

  it("x-cch-no-replay: 1 跳过 attach（不读 meta），但仍尝试成为 owner", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValue(makeMeta(identity, { status: "completed" }));
    storeControl.tryClaimOwner.mockResolvedValueOnce(true);
    const session = makeSession({ headers: { [REPLAY_BYPASS_HEADER]: "1" } });

    await expect(ProxyReplayGuard.ensure(session)).resolves.toBeNull();
    expect(storeControl.getMeta).not.toHaveBeenCalled();
    expect(storeControl.tryClaimOwner).toHaveBeenCalledWith(identity.replayId, expect.any(String));
    expect(session.replayState?.role).toBe("owner");
  });

  it("存储异常 fail-open：照常放行", async () => {
    storeControl.getMeta.mockRejectedValueOnce(new Error("redis exploded"));

    await expect(ProxyReplayGuard.ensure(makeSession())).resolves.toBeNull();
  });
});

describe("ProxyReplayGuard：completed 全量重放", () => {
  it("Redis 热层 completed：全量重放响应头与 body，并写审计行", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(
      makeMeta(identity, { status: "completed", statusCode: 200 })
    );
    storeControl.readChunks.mockResolvedValueOnce(["data: a\n\n", "data: b\n\n"]);
    const session = makeSession();

    const response = await ProxyReplayGuard.ensure(session);

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response?.headers.get("cache-control")).toBe("no-cache");
    expect(response?.headers.get("x-cch-replay")).toBe("completed");
    await expect(response?.text()).resolves.toBe("data: a\n\ndata: b\n\n");

    expect(storeControl.readChunks).toHaveBeenCalledWith(identity.replayId, 0);
    expect(storeControl.tryClaimOwner).not.toHaveBeenCalled();

    expect(dbControl.rows).toHaveLength(1);
    expect(dbControl.rows[0]).toMatchObject({
      providerId: 0,
      userId: 22,
      key: "sk-test",
      model: "claude-sonnet-4",
      sessionId: "sess-1",
      statusCode: 200,
      costUsd: "0",
      blockedBy: "replay_serve",
      endpoint: "/v1/messages",
      messagesCount: 1,
      userAgent: "vitest-agent",
    });
    expect(String(dbControl.rows[0].blockedReason)).toContain("redis_completed");
    expect(String(dbControl.rows[0].blockedReason)).toContain(identity.replayId.slice(0, 12));
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
    });

    const response = await ProxyReplayGuard.ensure(makeSession());

    expect(response?.headers.get("x-cch-replay")).toBe("completed");
    await expect(response?.text()).resolves.toBe("data: pg\n\n");
    expect(String(dbControl.rows[0].blockedReason)).toContain("pg_completed");
  });

  it("Redis 全 miss 时 PG 持久层直接命中；headersJson 缺失回退 SSE 头", async () => {
    const identity = expectedIdentity();
    storeControl.findCompleted.mockResolvedValueOnce({
      verifier: identity.verifier,
      statusCode: 201,
      headersJson: null,
      payload: "data: durable\n\n",
    });

    const response = await ProxyReplayGuard.ensure(makeSession());

    expect(response?.status).toBe(201);
    expect(response?.headers.get("content-type")).toBe("text/event-stream");
    await expect(response?.text()).resolves.toBe("data: durable\n\n");
    expect(dbControl.rows[0]).toMatchObject({ statusCode: 201, blockedBy: "replay_serve" });
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
    const completed = makeMeta(identity, { status: "completed" });
    const metaSequence: ReplayMeta[] = [makeMeta(identity, { status: "owning" })];
    storeControl.getMeta.mockImplementation(async () => metaSequence.shift() ?? completed);

    // pull 循环时序：(0)->前缀["a"]；(1)->[] 触发 meta 查询得 completed；
    // tail(1)->["b"]（completed 与最后一批块的竞态补读）；(2)->[]；tail(2)->[] 收尾
    const chunkSequence: string[][] = [["data: a\n\n"], [], ["data: b\n\n"], [], []];
    storeControl.readChunks.mockImplementation(async () => chunkSequence.shift() ?? []);

    const response = await ProxyReplayGuard.ensure(makeSession());

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(response?.headers.get("x-cch-replay")).toBe("live");
    await expect(response?.text()).resolves.toBe("data: a\n\ndata: b\n\n");

    expect(dbControl.rows).toHaveLength(1);
    expect(dbControl.rows[0]).toMatchObject({
      blockedBy: "replay_serve",
      costUsd: "0",
      providerId: 0,
    });
    expect(String(dbControl.rows[0].blockedReason)).toContain("attached_live");
    expect(storeControl.tryClaimOwner).not.toHaveBeenCalled();
  });

  it("attach 中 Redis 失联按传输错误终止流", async () => {
    const identity = expectedIdentity();
    storeControl.getMeta.mockResolvedValueOnce(makeMeta(identity, { status: "owning" }));
    storeControl.readChunks.mockResolvedValueOnce(null);

    const response = await ProxyReplayGuard.ensure(makeSession());

    expect(response).not.toBeNull();
    await expect(response?.text()).rejects.toThrow("replay attach lost redis connection");
    expect(dbControl.rows).toHaveLength(1);
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
  });
});
