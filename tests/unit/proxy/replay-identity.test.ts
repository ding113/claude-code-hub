import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveReplayIdentity } from "@/app/v1/_lib/proxy/replay/replay-identity";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { buildScopeTag } from "@/lib/request-identity";

/**
 * F2 Replay 身份推导单测。
 *
 * deriveReplayIdentity 是纯函数（除 getEnvConfig 读 flag），这里 mock
 * "@/lib/config/env.schema" 注入 ENABLE_REQUEST_REPLAY（模式复刻
 * tests/unit/proxy/stream-gate-forwarder-integration.test.ts），其余字段取
 * EnvSchema.parse({}) 默认值；session 用最小 stub。
 */

const envControl = vi.hoisted(() => ({
  enableReplay: true,
}));

vi.mock("@/lib/config/env.schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/env.schema")>();
  const baseEnv = actual.EnvSchema.parse({});
  return {
    ...actual,
    getEnvConfig: () => ({ ...baseEnv, ENABLE_REQUEST_REPLAY: envControl.enableReplay }),
  };
});

interface SessionStubOverrides {
  method?: string;
  policyKind?: string;
  message?: Record<string, unknown> | undefined;
  buffer?: ArrayBuffer;
  model?: string | null;
  keyId?: number;
  userId?: number;
  authState?: null;
  format?: string;
  endpoint?: string | null;
  headers?: Record<string, string>;
}

const DEFAULT_MODEL = "claude-sonnet-4";

function makeSession(overrides: SessionStubOverrides = {}): ProxySession {
  const message =
    "message" in overrides
      ? overrides.message
      : { stream: true, model: DEFAULT_MODEL, messages: [{ role: "user", content: "hi" }] };
  const model = "model" in overrides ? (overrides.model ?? null) : DEFAULT_MODEL;
  const authState =
    "authState" in overrides
      ? overrides.authState
      : { key: { id: overrides.keyId ?? 11 }, user: { id: overrides.userId ?? 22 } };
  return {
    method: overrides.method ?? "POST",
    headers: new Headers(overrides.headers ?? {}),
    request: { message, buffer: overrides.buffer, model },
    authState,
    originalFormat: overrides.format ?? "claude",
    getEndpointPolicy: () => ({ kind: overrides.policyKind ?? "default" }),
    getOriginalModel: () => model,
    getEndpoint: () => ("endpoint" in overrides ? (overrides.endpoint ?? null) : "/v1/messages"),
  } as unknown as ProxySession;
}

beforeEach(() => {
  envControl.enableReplay = true;
});

describe("deriveReplayIdentity：确定性", () => {
  it("相同规范化输入重推导得到相同 replayId 与 verifier", () => {
    const first = deriveReplayIdentity(makeSession());
    const second = deriveReplayIdentity(makeSession());
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.replayId).toBe(first?.replayId);
    expect(second?.verifier).toBe(first?.verifier);
  });

  it("message 键序不同但内容相同应得到相同 replayId（键序稳定序列化）", () => {
    const a = deriveReplayIdentity(
      makeSession({ message: { max_tokens: 8, stream: true, model: DEFAULT_MODEL } })
    );
    const b = deriveReplayIdentity(
      makeSession({ message: { stream: true, model: DEFAULT_MODEL, max_tokens: 8 } })
    );
    expect(a?.replayId).toBe(b?.replayId);
    expect(a?.verifier).toBe(b?.verifier);
  });

  it("身份基于过滤后 message，不受原始 buffer 影响（同 message 不同 buffer 同 ID）", () => {
    const bufferA = new TextEncoder().encode('{"stream":true,"raw":"a"}').buffer as ArrayBuffer;
    const bufferB = new TextEncoder().encode('{"stream":true,"raw":"b"}').buffer as ArrayBuffer;
    const message = { stream: true, model: DEFAULT_MODEL, messages: [{ role: "user" }] };
    const a = deriveReplayIdentity(makeSession({ buffer: bufferA, message: { ...message } }));
    const b = deriveReplayIdentity(makeSession({ buffer: bufferB, message: { ...message } }));
    expect(a?.replayId).toBe(b?.replayId);
    expect(a?.verifier).toBe(b?.verifier);

    // 反向：buffer 相同但过滤后 message 不同 -> 身份不同（过滤规则变更产生新身份）
    const c = deriveReplayIdentity(
      makeSession({ buffer: bufferA, message: { ...message, extra: 1 } })
    );
    expect(c?.replayId).not.toBe(a?.replayId);
  });

  it("长度与格式稳定：replayId/verifier 为 32 位小写 hex，scopeTag 为 16 位 hex", () => {
    const identity = deriveReplayIdentity(makeSession());
    expect(identity?.replayId).toMatch(/^[0-9a-f]{32}$/);
    expect(identity?.verifier).toMatch(/^[0-9a-f]{32}$/);
    expect(identity?.scopeTag).toBe(buildScopeTag(11, "claude", DEFAULT_MODEL));
    expect(identity?.scopeTag).toMatch(/^[0-9a-f]{16}$/);
  });

  it("返回完整上下文字段", () => {
    const identity = deriveReplayIdentity(makeSession());
    expect(identity).toMatchObject({
      keyId: 11,
      userId: 22,
      format: "claude",
      model: DEFAULT_MODEL,
      endpoint: "/v1/messages",
    });
  });

  it('getEndpoint 为 null 时回退到 "/"', () => {
    const identity = deriveReplayIdentity(makeSession({ endpoint: null }));
    expect(identity?.endpoint).toBe("/");
  });
});

describe("deriveReplayIdentity：任一身份维度变化 ID 即变化", () => {
  const base = () => deriveReplayIdentity(makeSession());

  it("body 变化", () => {
    const changed = deriveReplayIdentity(
      makeSession({ message: { stream: true, model: DEFAULT_MODEL, messages: [] } })
    );
    expect(changed?.replayId).not.toBe(base()?.replayId);
    expect(changed?.verifier).not.toBe(base()?.verifier);
  });

  it("keyId 变化只影响 replayId，verifier 保持内容维度不变", () => {
    const changed = deriveReplayIdentity(makeSession({ keyId: 12 }));
    expect(changed?.replayId).not.toBe(base()?.replayId);
    expect(changed?.verifier).toBe(base()?.verifier);
  });

  it("model 变化", () => {
    const changed = deriveReplayIdentity(makeSession({ model: "claude-opus-4" }));
    expect(changed?.replayId).not.toBe(base()?.replayId);
    expect(changed?.verifier).not.toBe(base()?.verifier);
  });

  it("endpoint 变化", () => {
    const changed = deriveReplayIdentity(makeSession({ endpoint: "/v1/chat/completions" }));
    expect(changed?.replayId).not.toBe(base()?.replayId);
  });

  it("idempotency-key 变化", () => {
    const a = deriveReplayIdentity(makeSession({ headers: { "idempotency-key": "ik-1" } }));
    const b = deriveReplayIdentity(makeSession({ headers: { "idempotency-key": "ik-2" } }));
    expect(a?.replayId).not.toBe(base()?.replayId);
    expect(a?.replayId).not.toBe(b?.replayId);
    expect(a?.verifier).not.toBe(b?.verifier);
  });

  it("x-idempotency-key 参与推导，且 idempotency-key 优先", () => {
    const xOnly = deriveReplayIdentity(makeSession({ headers: { "x-idempotency-key": "ik-x" } }));
    expect(xOnly?.replayId).not.toBe(base()?.replayId);

    const both = deriveReplayIdentity(
      makeSession({ headers: { "idempotency-key": "ik-1", "x-idempotency-key": "ik-x" } })
    );
    const primaryOnly = deriveReplayIdentity(
      makeSession({ headers: { "idempotency-key": "ik-1" } })
    );
    expect(both?.replayId).toBe(primaryOnly?.replayId);
  });

  it("verifier 与 replayId 不同源（不同盐，同输入不相等）", () => {
    const identity = deriveReplayIdentity(makeSession());
    expect(identity?.verifier).not.toBe(identity?.replayId);
  });
});

describe("deriveReplayIdentity：不合格条件返回 null", () => {
  it("功能开关关闭", () => {
    envControl.enableReplay = false;
    expect(deriveReplayIdentity(makeSession())).toBeNull();
  });

  it("非 default endpoint policy", () => {
    expect(deriveReplayIdentity(makeSession({ policyKind: "raw_passthrough" }))).toBeNull();
  });

  it("非 POST 请求", () => {
    expect(deriveReplayIdentity(makeSession({ method: "GET" }))).toBeNull();
  });

  it("非流式请求（stream 缺失或 false）", () => {
    expect(
      deriveReplayIdentity(makeSession({ message: { stream: false, model: DEFAULT_MODEL } }))
    ).toBeNull();
    expect(deriveReplayIdentity(makeSession({ message: { model: DEFAULT_MODEL } }))).toBeNull();
  });

  it("缺认证主体（authState 为 null 或 keyId falsy）", () => {
    expect(deriveReplayIdentity(makeSession({ authState: null }))).toBeNull();
    expect(deriveReplayIdentity(makeSession({ keyId: 0 }))).toBeNull();
  });

  it("message 缺失导致内部异常时 fail-open 返回 null", () => {
    expect(deriveReplayIdentity(makeSession({ message: undefined }))).toBeNull();
  });
});
