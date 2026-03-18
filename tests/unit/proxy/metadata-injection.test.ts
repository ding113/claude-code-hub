import { describe, expect, it } from "vitest";
import { injectClaudeMetadataUserId } from "@/app/v1/_lib/proxy/forwarder";
import { ProxySession } from "@/app/v1/_lib/proxy/session";

const LEGACY_USER_AGENT = "claude-cli/2.1.77 (external, cli)";
const JSON_USER_AGENT = "claude-cli/2.1.78 (external, cli)";

function createSession(
  keyId: number | null | undefined = 123,
  sessionId: string | null | undefined = "sess_test",
  userAgent: string | null = LEGACY_USER_AGENT
): ProxySession {
  const session = Object.create(ProxySession.prototype) as ProxySession;
  (session as Record<string, unknown>).authState =
    keyId === undefined ? undefined : { key: { id: keyId } };
  (session as Record<string, unknown>).sessionId = sessionId ?? null;
  (session as Record<string, unknown>).userAgent = userAgent;
  return session;
}

function extractLegacyDeviceId(userId: string): string {
  const match = userId.match(/^user_([a-f0-9]{64})_account__session_/);
  if (!match) {
    throw new Error(`Unexpected user_id format: ${userId}`);
  }
  return match[1];
}

function parseJsonUserId(userId: string): Record<string, unknown> {
  return JSON.parse(userId) as Record<string, unknown>;
}

describe("injectClaudeMetadataUserId", () => {
  it("低版本 Claude Code 无 metadata 时应注入旧格式 user_id", () => {
    const message: Record<string, unknown> = { model: "claude-3-5-sonnet" };
    const session = createSession(42, "sess_abc123", LEGACY_USER_AGENT);

    const result = injectClaudeMetadataUserId(message, session);
    const metadata = result.metadata as Record<string, unknown>;

    expect(result).not.toBe(message);
    expect(metadata.user_id).toMatch(/^user_[a-f0-9]{64}_account__session_sess_abc123$/);
  });

  it("新版本 Claude Code 无 metadata 时应注入 JSON 字符串 user_id", () => {
    const message: Record<string, unknown> = { model: "claude-3-5-sonnet" };
    const session = createSession(42, "sess_json_123", JSON_USER_AGENT);

    const result = injectClaudeMetadataUserId(message, session);
    const metadata = result.metadata as Record<string, unknown>;

    expect(result).not.toBe(message);
    expect(parseJsonUserId(metadata.user_id as string)).toEqual({
      device_id: expect.stringMatching(/^[a-f0-9]{64}$/),
      account_uuid: "",
      session_id: "sess_json_123",
    });
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

  it("metadata.user_id 为空字符串时应继续补全", () => {
    const message: Record<string, unknown> = {
      metadata: {
        user_id: "",
      },
    };
    const session = createSession(42, "sess_abc123");

    const result = injectClaudeMetadataUserId(message, session);

    expect(result).not.toBe(message);
    expect((result.metadata as Record<string, unknown>).user_id).toMatch(
      /^user_[a-f0-9]{64}_account__session_sess_abc123$/
    );
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
    const sessionA = createSession(7, "sess_one", LEGACY_USER_AGENT);
    const sessionB = createSession(7, "sess_two", LEGACY_USER_AGENT);

    const userIdA = (
      injectClaudeMetadataUserId(messageA, sessionA).metadata as Record<string, unknown>
    ).user_id as string;
    const userIdB = (
      injectClaudeMetadataUserId(messageB, sessionB).metadata as Record<string, unknown>
    ).user_id as string;

    expect(extractLegacyDeviceId(userIdA)).toBe(extractLegacyDeviceId(userIdB));
  });

  it("不同 keyId 应生成不同 hash", () => {
    const messageA: Record<string, unknown> = {};
    const messageB: Record<string, unknown> = {};
    const sessionA = createSession(7, "sess_same", LEGACY_USER_AGENT);
    const sessionB = createSession(8, "sess_same", LEGACY_USER_AGENT);

    const userIdA = (
      injectClaudeMetadataUserId(messageA, sessionA).metadata as Record<string, unknown>
    ).user_id as string;
    const userIdB = (
      injectClaudeMetadataUserId(messageB, sessionB).metadata as Record<string, unknown>
    ).user_id as string;

    expect(extractLegacyDeviceId(userIdA)).not.toBe(extractLegacyDeviceId(userIdB));
  });

  it("无法获取版本时应默认注入 JSON 字符串 user_id", () => {
    const message: Record<string, unknown> = {};
    const session = createSession(42, "sess_unknown", null);

    const result = injectClaudeMetadataUserId(message, session);
    const metadata = result.metadata as Record<string, unknown>;

    expect(parseJsonUserId(metadata.user_id as string)).toEqual({
      device_id: expect.stringMatching(/^[a-f0-9]{64}$/),
      account_uuid: "",
      session_id: "sess_unknown",
    });
  });

  it("metadata 为非对象类型时应安全处理", () => {
    const message: Record<string, unknown> = {
      metadata: "not-an-object",
    };
    const session = createSession(42, "sess_abc123", JSON_USER_AGENT);

    const result = injectClaudeMetadataUserId(message, session);
    const metadata = result.metadata as Record<string, unknown>;

    expect(result).not.toBe(message);
    expect(typeof metadata).toBe("object");
    expect(parseJsonUserId(metadata.user_id as string)).toEqual({
      device_id: expect.stringMatching(/^[a-f0-9]{64}$/),
      account_uuid: "",
      session_id: "sess_abc123",
    });
  });
});
