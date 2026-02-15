import { describe, expect, it } from "vitest";
import { injectClaudeMetadataUserId } from "@/app/v1/_lib/proxy/forwarder";
import { ProxySession } from "@/app/v1/_lib/proxy/session";

function createSession(
  keyId: number | null | undefined = 123,
  sessionId: string | null | undefined = "sess_test"
): ProxySession {
  const session = Object.create(ProxySession.prototype) as ProxySession;
  (session as Record<string, unknown>).authState =
    keyId === undefined ? undefined : { key: { id: keyId } };
  (session as Record<string, unknown>).sessionId = sessionId ?? null;
  return session;
}

function extractUserHash(userId: string): string {
  const match = userId.match(/^user_([a-f0-9]{64})_account__session_/);
  if (!match) {
    throw new Error(`Unexpected user_id format: ${userId}`);
  }
  return match[1];
}

describe("injectClaudeMetadataUserId", () => {
  it("无 metadata 时应正确注入 user_id", () => {
    const message: Record<string, unknown> = { model: "claude-3-5-sonnet" };
    const session = createSession(42, "sess_abc123");

    const result = injectClaudeMetadataUserId(message, session);
    const metadata = result.metadata as Record<string, unknown>;

    expect(result).not.toBe(message);
    expect(metadata.user_id).toMatch(/^user_[a-f0-9]{64}_account__session_sess_abc123$/);
  });

  it("已有 metadata.user_id 时应保持原样不覆盖", () => {
    const message: Record<string, unknown> = {
      metadata: {
        user_id: "existing_user_id",
        source: "client",
      },
    };
    const session = createSession(42, "sess_abc123");

    const result = injectClaudeMetadataUserId(message, session);

    expect(result).toBe(message);
    expect((result.metadata as Record<string, unknown>).user_id).toBe("existing_user_id");
  });

  it("metadata.user_id 为空字符串时应保持原样不注入", () => {
    const message: Record<string, unknown> = {
      metadata: {
        user_id: "",
      },
    };
    const session = createSession(42, "sess_abc123");

    const result = injectClaudeMetadataUserId(message, session);

    expect(result).toBe(message);
    expect((result.metadata as Record<string, unknown>).user_id).toBe("");
  });

  it("keyId 缺失时应跳过注入并返回原始 message", () => {
    const message: Record<string, unknown> = { model: "claude-3" };
    const session = createSession(null, "sess_abc123");

    const result = injectClaudeMetadataUserId(message, session);

    expect(result).toBe(message);
    expect(result.metadata).toBeUndefined();
  });

  it("sessionId 缺失时应跳过注入", () => {
    const message: Record<string, unknown> = { model: "claude-3" };
    const session = createSession(42, null);

    const result = injectClaudeMetadataUserId(message, session);

    expect(result).toBe(message);
    expect(result.metadata).toBeUndefined();
  });

  it("相同 keyId 应生成相同 hash", () => {
    const messageA: Record<string, unknown> = {};
    const messageB: Record<string, unknown> = {};
    const sessionA = createSession(7, "sess_one");
    const sessionB = createSession(7, "sess_two");

    const userIdA = (
      injectClaudeMetadataUserId(messageA, sessionA).metadata as Record<string, unknown>
    ).user_id as string;
    const userIdB = (
      injectClaudeMetadataUserId(messageB, sessionB).metadata as Record<string, unknown>
    ).user_id as string;

    expect(extractUserHash(userIdA)).toBe(extractUserHash(userIdB));
  });

  it("不同 keyId 应生成不同 hash", () => {
    const messageA: Record<string, unknown> = {};
    const messageB: Record<string, unknown> = {};
    const sessionA = createSession(7, "sess_same");
    const sessionB = createSession(8, "sess_same");

    const userIdA = (
      injectClaudeMetadataUserId(messageA, sessionA).metadata as Record<string, unknown>
    ).user_id as string;
    const userIdB = (
      injectClaudeMetadataUserId(messageB, sessionB).metadata as Record<string, unknown>
    ).user_id as string;

    expect(extractUserHash(userIdA)).not.toBe(extractUserHash(userIdB));
  });

  it("metadata 为非对象类型时应安全处理", () => {
    const message: Record<string, unknown> = {
      metadata: "not-an-object",
    };
    const session = createSession(42, "sess_abc123");

    const result = injectClaudeMetadataUserId(message, session);
    const metadata = result.metadata as Record<string, unknown>;

    expect(result).not.toBe(message);
    expect(typeof metadata).toBe("object");
    expect(metadata.user_id).toMatch(/^user_[a-f0-9]{64}_account__session_sess_abc123$/);
  });
});
