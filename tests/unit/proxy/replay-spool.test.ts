import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayIdentity } from "@/app/v1/_lib/proxy/replay/replay-identity";
import {
  createReplaySpoolIfOwner,
  getActiveReplaySpoolCount,
  ReplaySpool,
} from "@/app/v1/_lib/proxy/replay/replay-spool";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { logger } from "@/lib/logger";

/**
 * F2 owner 侧 spool 单测。
 *
 * mock "@/app/v1/_lib/proxy/replay/replay-store".getReplayStore 注入可观测
 * store mock（callOrder 记录调用顺序），env 走 EnvSchema.parse({}) 默认值 +
 * envControl 动态注入；write-behind 定时用 fake timers 驱动。
 */

const envControl = vi.hoisted(() => ({
  enableReplay: true,
  maxPayloadBytes: 8 * 1024 * 1024,
  maxConcurrentSpools: 64,
}));

const storeControl = vi.hoisted(() => {
  const order: string[] = [];
  const store = {
    appendChunks: vi.fn(async (_replayId: string, values: string[]) => {
      order.push(`append:${values.join("|")}`);
      return values.length;
    }),
    setMeta: vi.fn(async (_replayId: string, meta: { status: string }) => {
      order.push(`meta:${meta.status}`);
      return true;
    }),
    renewOwnerLease: vi.fn(async () => {
      order.push("renew");
      return true;
    }),
    releaseOwner: vi.fn(async () => {
      order.push("release");
    }),
    persistCompleted: vi.fn(async () => {
      order.push("persist");
    }),
    deleteEntry: vi.fn(async () => {
      order.push("deleteEntry");
    }),
    deleteChunks: vi.fn(async () => {
      order.push("deleteChunks");
    }),
  };
  return { order, store };
});

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
      REPLAY_MAX_PAYLOAD_BYTES: envControl.maxPayloadBytes,
      REPLAY_MAX_CONCURRENT_SPOOLS: envControl.maxConcurrentSpools,
    }),
  };
});

vi.mock("@/app/v1/_lib/proxy/replay/replay-store", () => ({
  getReplayStore: () => storeControl.store,
}));

const identity: ReplayIdentity = {
  replayId: "0123456789abcdef0123456789abcdef",
  verifier: "fedcba9876543210fedcba9876543210",
  scopeTag: "0011223344556677",
  keyId: 11,
  userId: 22,
  format: "claude",
  model: "claude-sonnet-4",
  endpoint: "/v1/messages",
};

const encoder = new TextEncoder();

function makeSpool(statusCode = 200, contentType = "text/event-stream"): ReplaySpool {
  return new ReplaySpool(identity, "owner-token", statusCode, contentType);
}

async function drainWriteChain(spool: ReplaySpool): Promise<void> {
  await (spool as unknown as { writeChain: Promise<void> }).writeChain;
}

function makeOwnerSession(): ProxySession {
  return {
    replayState: { identity, ownerToken: "owner-token", role: "owner" },
  } as unknown as ProxySession;
}

function sseResponse(status = 200, contentType: string | null = "text/event-stream"): Response {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  return new Response(null, { status, headers });
}

beforeEach(() => {
  envControl.enableReplay = true;
  envControl.maxPayloadBytes = 8 * 1024 * 1024;
  envControl.maxConcurrentSpools = 64;
  storeControl.order.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  expect(getActiveReplaySpoolCount()).toBe(0);
});

describe("ReplaySpool：write-behind 批量冲刷", () => {
  it("小块累积由 100ms 定时批量 RPUSH，并同步续 meta 心跳与 owner 租约", async () => {
    const spool = makeSpool();
    spool.observe(encoder.encode("data: a\n\n"));
    spool.observe(encoder.encode("data: b\n\n"));

    expect(storeControl.store.appendChunks).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    await drainWriteChain(spool);

    expect(storeControl.store.appendChunks).toHaveBeenCalledTimes(1);
    expect(storeControl.store.appendChunks).toHaveBeenCalledWith(identity.replayId, [
      "data: a\n\n",
      "data: b\n\n",
    ]);
    expect(storeControl.store.setMeta).toHaveBeenCalledWith(
      identity.replayId,
      expect.objectContaining({
        status: "owning",
        verifier: identity.verifier,
        scopeTag: identity.scopeTag,
        statusCode: 200,
        headers: { "content-type": "text/event-stream" },
        chunkCount: 2,
        byteSize: 18,
        heartbeatAt: expect.any(Number),
      })
    );
    expect(storeControl.store.renewOwnerLease).toHaveBeenCalledWith(
      identity.replayId,
      "owner-token"
    );

    await spool.abort("test_cleanup");
  });

  it("累积达到 64KB 阈值立即冲刷，不等待定时器", async () => {
    const spool = makeSpool();
    spool.observe(encoder.encode("x".repeat(64 * 1024)));

    await drainWriteChain(spool);

    expect(storeControl.store.appendChunks).toHaveBeenCalledTimes(1);

    await spool.abort("test_cleanup");
  });

  it("空 chunk 不触发任何调度", async () => {
    const spool = makeSpool();
    spool.observe(new Uint8Array(0));

    await vi.advanceTimersByTimeAsync(200);
    await drainWriteChain(spool);
    expect(storeControl.store.appendChunks).not.toHaveBeenCalled();

    await spool.abort("test_cleanup");
  });

  it("appendChunks 返回 null（Redis 不可用）时放弃 spool", async () => {
    storeControl.store.appendChunks.mockResolvedValueOnce(null);
    const spool = makeSpool();
    spool.observe(encoder.encode("data: a\n\n"));

    await vi.advanceTimersByTimeAsync(100);
    await drainWriteChain(spool);

    expect(storeControl.store.deleteEntry).toHaveBeenCalledWith(identity.replayId);
    expect(storeControl.store.releaseOwner).toHaveBeenCalledWith(identity.replayId, "owner-token");
    expect(storeControl.store.setMeta).not.toHaveBeenCalled();
    expect(getActiveReplaySpoolCount()).toBe(0);
  });

  it("冲刷续接体异常（setMeta 抛错）时 disable：链不被 poisoned、条目删除、租约释放", async () => {
    storeControl.store.setMeta.mockRejectedValueOnce(new Error("redis exploded"));
    const spool = makeSpool();
    spool.observe(encoder.encode("data: a\n\n"));

    await vi.advanceTimersByTimeAsync(100);
    // 链必须 resolve 而非 reject（unhandled rejection 防护）
    await expect(drainWriteChain(spool)).resolves.toBeUndefined();

    expect(storeControl.store.deleteEntry).toHaveBeenCalledWith(identity.replayId);
    expect(storeControl.store.releaseOwner).toHaveBeenCalledWith(identity.replayId, "owner-token");
    expect(spool.isTerminal).toBe(true);
    expect(getActiveReplaySpoolCount()).toBe(0);

    // 失效后 observe/complete 均为 no-op
    spool.observe(encoder.encode("data: late\n\n"));
    await vi.advanceTimersByTimeAsync(200);
    await spool.completeAfterBilling(1);
    expect(storeControl.store.persistCompleted).not.toHaveBeenCalled();
  });

  it("bootstrap 续接体异常同样 disable 而不 poison 链", async () => {
    storeControl.store.setMeta.mockRejectedValueOnce(new Error("redis exploded"));
    const spool = makeSpool();
    spool.bootstrap();

    await expect(drainWriteChain(spool)).resolves.toBeUndefined();
    expect(storeControl.store.deleteEntry).toHaveBeenCalledWith(identity.replayId);
    expect(spool.isTerminal).toBe(true);
    expect(getActiveReplaySpoolCount()).toBe(0);
  });
});

describe("ReplaySpool：续租丢失 halt", () => {
  it("renewOwnerLease 返回 false 时停止 spool、释放自方租约，但绝不删条目", async () => {
    storeControl.store.renewOwnerLease.mockResolvedValueOnce(false);
    const spool = makeSpool();
    spool.observe(encoder.encode("data: a\n\n"));

    await vi.advanceTimersByTimeAsync(100);
    await drainWriteChain(spool);

    // 新 owner 可能已在写同一 LIST：只 compare-delete 自己的租约，不碰 chunks/meta
    expect(storeControl.store.releaseOwner).toHaveBeenCalledWith(identity.replayId, "owner-token");
    expect(storeControl.store.deleteEntry).not.toHaveBeenCalled();
    expect(storeControl.store.deleteChunks).not.toHaveBeenCalled();
    expect(spool.isTerminal).toBe(true);
    expect(getActiveReplaySpoolCount()).toBe(0);

    // halt 后 abort 不得再写 aborted meta 覆盖新 owner
    storeControl.store.setMeta.mockClear();
    await spool.abort("late_abort");
    expect(storeControl.store.setMeta).not.toHaveBeenCalled();
    expect(storeControl.store.deleteChunks).not.toHaveBeenCalled();
  });

  it("halt 后 complete 为 no-op", async () => {
    storeControl.store.renewOwnerLease.mockResolvedValueOnce(false);
    const spool = makeSpool();
    spool.observe(encoder.encode("data: a\n\n"));
    await vi.advanceTimersByTimeAsync(100);
    await drainWriteChain(spool);

    await spool.completeAfterBilling(1);
    expect(storeControl.store.persistCompleted).not.toHaveBeenCalled();
    const metaStatuses = storeControl.store.setMeta.mock.calls.map(
      (call) => (call[1] as { status: string }).status
    );
    expect(metaStatuses).not.toContain("completed");
  });
});

describe("ReplaySpool：超尺寸自失效", () => {
  it("超过 REPLAY_MAX_PAYLOAD_BYTES 停止 spool、删除已写条目并释放租约", async () => {
    envControl.maxPayloadBytes = 16;
    const spool = makeSpool();

    spool.observe(encoder.encode("x".repeat(32)));

    // 计数同步归还；存储清理顺着 writeChain 串行执行（避免与 in-flight append 竞态）
    expect(getActiveReplaySpoolCount()).toBe(0);
    await drainWriteChain(spool);
    expect(storeControl.store.deleteEntry).toHaveBeenCalledWith(identity.replayId);
    expect(storeControl.store.releaseOwner).toHaveBeenCalledWith(identity.replayId, "owner-token");

    // 已失效：后续 observe 与 complete 均为 no-op
    spool.observe(encoder.encode("more"));
    await vi.advanceTimersByTimeAsync(200);
    await spool.completeAfterBilling(1);
    expect(storeControl.store.appendChunks).not.toHaveBeenCalled();
    expect(storeControl.store.persistCompleted).not.toHaveBeenCalled();
    expect(storeControl.store.setMeta).not.toHaveBeenCalled();
  });
});

describe("ReplaySpool：completeAfterBilling 终态屏障", () => {
  it("按 尾批冲刷 -> PG 持久化 -> completed meta -> 释放租约 顺序执行", async () => {
    const spool = makeSpool(200, "text/event-stream; charset=utf-8");
    spool.observe(encoder.encode("data: hello \n\n"));
    spool.observe(encoder.encode("data: world\n\n"));

    await spool.completeAfterBilling(42);

    expect(storeControl.order).toEqual([
      "append:data: hello \n\n|data: world\n\n",
      "persist",
      "meta:completed",
      "release",
    ]);
    expect(storeControl.store.persistCompleted).toHaveBeenCalledWith({
      replayId: identity.replayId,
      verifier: identity.verifier,
      scopeTag: identity.scopeTag,
      keyId: 11,
      userId: 22,
      format: "claude",
      model: "claude-sonnet-4",
      statusCode: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
      payload: "data: hello \n\ndata: world\n\n",
      byteSize: 27,
      sourceMessageRequestId: 42,
    });
    expect(storeControl.store.setMeta).toHaveBeenCalledWith(
      identity.replayId,
      expect.objectContaining({ status: "completed", messageRequestId: 42, chunkCount: 2 })
    );
    expect(getActiveReplaySpoolCount()).toBe(0);
  });

  it("completed 只出现在 persistCompleted 成功之后；persist 失败则降级为 aborted 并清残块", async () => {
    storeControl.store.persistCompleted.mockRejectedValueOnce(new Error("pg down"));
    const spool = makeSpool();
    spool.observe(encoder.encode("data: a\n\n"));

    await spool.completeAfterBilling(7);

    const metaStatuses = storeControl.store.setMeta.mock.calls.map(
      (call) => (call[1] as { status: string }).status
    );
    expect(metaStatuses).not.toContain("completed");
    expect(metaStatuses).toContain("aborted");
    expect(storeControl.store.deleteChunks).toHaveBeenCalledWith(identity.replayId);
    expect(storeControl.store.releaseOwner).toHaveBeenCalledWith(identity.replayId, "owner-token");
    expect(logger.warn).toHaveBeenCalledWith(
      "[ReplaySpool] complete failed, aborting entry",
      expect.objectContaining({ pgPersisted: false })
    );
    expect(getActiveReplaySpoolCount()).toBe(0);
  });

  it("尾批冲刷返回 null（Redis 不可用）时终止为 aborted，绝不置 completed 也不写 PG", async () => {
    storeControl.store.appendChunks.mockResolvedValueOnce(null);
    const spool = makeSpool();
    spool.observe(encoder.encode("data: a\n\n"));

    await spool.completeAfterBilling(5);

    expect(storeControl.store.persistCompleted).not.toHaveBeenCalled();
    const metaStatuses = storeControl.store.setMeta.mock.calls.map(
      (call) => (call[1] as { status: string }).status
    );
    expect(metaStatuses).not.toContain("completed");
    expect(metaStatuses).toContain("aborted");
    expect(storeControl.store.deleteChunks).toHaveBeenCalledWith(identity.replayId);
    expect(storeControl.store.releaseOwner).toHaveBeenCalledWith(identity.replayId, "owner-token");
    expect(getActiveReplaySpoolCount()).toBe(0);
  });

  it("persist 成功但 completed 翻转失败：日志标记 pgPersisted=true，热层封死为 aborted", async () => {
    // 首次 setMeta 即 complete 续接体里的 completed 写入（无 bootstrap、定时器未触发）
    storeControl.store.setMeta.mockRejectedValueOnce(new Error("redis down"));
    const spool = makeSpool();
    spool.observe(encoder.encode("data: a\n\n"));

    await spool.completeAfterBilling(7);

    expect(storeControl.store.persistCompleted).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "[ReplaySpool] complete failed, aborting entry",
      expect.objectContaining({ pgPersisted: true })
    );
    const metaStatuses = storeControl.store.setMeta.mock.calls.map(
      (call) => (call[1] as { status: string }).status
    );
    expect(metaStatuses).toContain("aborted");
    expect(getActiveReplaySpoolCount()).toBe(0);
  });

  it("跨 chunk 截断的 UTF-8 序列在 complete 时冲刷解码尾部", async () => {
    const spool = makeSpool();
    // "中" (0xE4 0xB8 0xAD) 只送前两字节：observe 阶段解码挂起，complete 时 flush 出替换字符
    spool.observe(new Uint8Array([0xe4, 0xb8]));
    expect(storeControl.store.appendChunks).not.toHaveBeenCalled();

    await spool.completeAfterBilling(9);

    expect(storeControl.store.appendChunks).toHaveBeenCalledWith(identity.replayId, ["\uFFFD"]);
    expect(storeControl.store.persistCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ payload: "\uFFFD", byteSize: 2 })
    );
  });

  it("重复 complete 是幂等 no-op", async () => {
    const spool = makeSpool();
    spool.observe(encoder.encode("data: a\n\n"));
    await spool.completeAfterBilling(1);

    storeControl.order.length = 0;
    await spool.completeAfterBilling(2);
    expect(storeControl.order).toEqual([]);
  });
});

describe("ReplaySpool：abort 终态", () => {
  it("置 aborted meta、删除响应块并释放租约", async () => {
    const spool = makeSpool();
    spool.observe(encoder.encode("data: partial\n\n"));

    await spool.abort("upstream_error");

    expect(storeControl.store.setMeta).toHaveBeenCalledWith(
      identity.replayId,
      expect.objectContaining({ status: "aborted", abortReason: "upstream_error" })
    );
    expect(storeControl.store.deleteChunks).toHaveBeenCalledWith(identity.replayId);
    expect(storeControl.store.releaseOwner).toHaveBeenCalledWith(identity.replayId, "owner-token");
    expect(storeControl.order).toEqual(["meta:aborted", "deleteChunks", "release"]);
    expect(getActiveReplaySpoolCount()).toBe(0);
  });

  it("abort 后 observe 与 complete 均无副作用", async () => {
    const spool = makeSpool();
    await spool.abort("client_disconnect");
    storeControl.order.length = 0;

    spool.observe(encoder.encode("data: late\n\n"));
    await vi.advanceTimersByTimeAsync(200);
    await spool.completeAfterBilling(1);

    expect(storeControl.order).toEqual([]);
    expect(storeControl.store.appendChunks).not.toHaveBeenCalled();
    expect(storeControl.store.persistCompleted).not.toHaveBeenCalled();
  });
});

describe("ReplaySpool：isTerminal", () => {
  it("abort 置 terminal，disable（超限）置 disabled，两者均视为终态", async () => {
    const aborted = makeSpool();
    expect(aborted.isTerminal).toBe(false);
    await aborted.abort("done");
    expect(aborted.isTerminal).toBe(true);

    envControl.maxPayloadBytes = 4;
    const oversized = makeSpool();
    oversized.observe(encoder.encode("12345678"));
    expect(oversized.isTerminal).toBe(true);
    await drainWriteChain(oversized);
  });
});

describe("createReplaySpoolIfOwner", () => {
  it("非 owner 会话返回 null（无租约可释放）", () => {
    const session = { replayState: null } as unknown as ProxySession;
    expect(createReplaySpoolIfOwner(session, sseResponse())).toBeNull();
    expect(storeControl.store.releaseOwner).not.toHaveBeenCalled();
  });

  it("功能开关关闭返回 null，并释放租约、清 replayState", () => {
    envControl.enableReplay = false;
    const session = makeOwnerSession();
    expect(createReplaySpoolIfOwner(session, sseResponse())).toBeNull();
    expect(storeControl.store.releaseOwner).toHaveBeenCalledWith(identity.replayId, "owner-token");
    expect(session.replayState).toBeNull();
  });

  it("非 2xx 或非 SSE 响应返回 null，并释放租约、清 replayState", () => {
    const non2xx = makeOwnerSession();
    expect(createReplaySpoolIfOwner(non2xx, sseResponse(500))).toBeNull();
    expect(non2xx.replayState).toBeNull();

    const nonSse = makeOwnerSession();
    expect(createReplaySpoolIfOwner(nonSse, sseResponse(200, "application/json"))).toBeNull();
    expect(nonSse.replayState).toBeNull();

    expect(storeControl.store.releaseOwner).toHaveBeenCalledTimes(2);
    expect(storeControl.store.releaseOwner).toHaveBeenCalledWith(identity.replayId, "owner-token");
  });

  it("并发 spool 达上限时返回 null，并释放落选者租约", async () => {
    envControl.maxConcurrentSpools = 1;
    const first = createReplaySpoolIfOwner(makeOwnerSession(), sseResponse());
    expect(first).toBeInstanceOf(ReplaySpool);
    expect(storeControl.store.releaseOwner).not.toHaveBeenCalled();

    const second = makeOwnerSession();
    expect(createReplaySpoolIfOwner(second, sseResponse())).toBeNull();
    expect(second.replayState).toBeNull();
    expect(storeControl.store.releaseOwner).toHaveBeenCalledWith(identity.replayId, "owner-token");

    await first?.abort("test_cleanup");
  });

  it("正常创建 owner spool 并立即 bootstrap owning meta", async () => {
    const spool = createReplaySpoolIfOwner(makeOwnerSession(), sseResponse());
    expect(spool).toBeInstanceOf(ReplaySpool);
    expect(getActiveReplaySpoolCount()).toBe(1);

    await drainWriteChain(spool as ReplaySpool);
    expect(storeControl.store.setMeta).toHaveBeenCalledWith(
      identity.replayId,
      expect.objectContaining({ status: "owning", chunkCount: 0, byteSize: 0 })
    );

    await spool?.abort("test_cleanup");
  });

  it("上游未带 content-type 时按 text/event-stream 处理", async () => {
    const spool = createReplaySpoolIfOwner(makeOwnerSession(), sseResponse(200, null));
    expect(spool).toBeInstanceOf(ReplaySpool);

    await drainWriteChain(spool as ReplaySpool);
    expect(storeControl.store.setMeta).toHaveBeenCalledWith(
      identity.replayId,
      expect.objectContaining({ headers: { "content-type": "text/event-stream" } })
    );

    await spool?.abort("test_cleanup");
  });
});
