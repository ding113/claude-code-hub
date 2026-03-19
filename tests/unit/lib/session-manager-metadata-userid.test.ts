import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    trace: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("SessionManager.extractClientSessionId", () => {
  test("应从新版 json metadata.user_id 提取 session_id", async () => {
    const { SessionManager } = await import("@/lib/session-manager");

    const sessionId = SessionManager.extractClientSessionId({
      metadata: {
        user_id: 'json{"device_id":"dev-1","account_uuid":"acc-2","session_id":"sess-json-123"}',
      },
    });

    expect(sessionId).toBe("sess-json-123");
  });

  test("应继续兼容旧版 legacy metadata.user_id", async () => {
    const { SessionManager } = await import("@/lib/session-manager");

    const sessionId = SessionManager.extractClientSessionId({
      metadata: {
        user_id: "user_deadbeef_account_acc-123_session_sess-legacy-456",
      },
    });

    expect(sessionId).toBe("sess-legacy-456");
  });

  test("当 user_id 不可解析时应回退到 metadata.session_id", async () => {
    const { SessionManager } = await import("@/lib/session-manager");

    const sessionId = SessionManager.extractClientSessionId({
      metadata: {
        user_id: "invalid-userid-format",
        session_id: "sess-fallback-789",
      },
    });

    expect(sessionId).toBe("sess-fallback-789");
  });
});
