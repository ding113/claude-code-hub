import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock server-only before any imports
vi.mock("server-only", () => ({}));

// Mock dependencies
vi.mock("@/lib/session-manager");
vi.mock("@/lib/session-tracker");
vi.mock("@/lib/logger");
vi.mock("@/drizzle/db", () => ({
  db: {},
}));
vi.mock("@/lib/redis", () => ({
  getRedisClient: vi.fn(() => null),
}));

import { ProxySessionGuard } from "./session-guard";
import type { ProxySession } from "./session";
import { SessionManager } from "@/lib/session-manager";
import { SessionTracker } from "@/lib/session-tracker";
import { logger } from "@/lib/logger";

describe("ProxySessionGuard", () => {
  // Helper function to create a mock ProxySession
  const createMockSession = (overrides = {}) => {
    const mockSession = {
      authState: {
        key: { id: 1, name: "test-key" },
        user: { id: 10, name: "test-user" },
        apiKey: "test-api-key",
        success: true,
      },
      request: {
        message: {
          messages: [{ role: "user", content: "test message" }],
          model: "claude-sonnet-4",
        },
        model: "claude-sonnet-4",
        log: "test log",
      },
      originalFormat: "claude",
      sessionId: null,
      setSessionId: vi.fn(),
      getMessages: vi.fn(() => [{ role: "user", content: "test message" }]),
      getMessagesLength: vi.fn(() => 1),
      ...overrides,
    };
    return mockSession as unknown as ProxySession;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ensure()", () => {
    it("should skip session assignment when key ID is missing", async () => {
      const session = createMockSession({
        authState: null,
      });

      await ProxySessionGuard.ensure(session);

      expect(logger.warn).toHaveBeenCalledWith(
        "[ProxySessionGuard] No key ID, skipping session assignment"
      );
      expect(SessionManager.extractClientSessionId).not.toHaveBeenCalled();
      expect(session.setSessionId).not.toHaveBeenCalled();
    });

    it("should successfully assign session ID from client metadata", async () => {
      const session = createMockSession();
      const clientSessionId = "client-sess-123";
      const mockSessionId = "sess-456";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(clientSessionId);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionMessages).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      expect(SessionManager.extractClientSessionId).toHaveBeenCalledWith(session.request.message);
      expect(SessionManager.getOrCreateSessionId).toHaveBeenCalledWith(
        1,
        [{ role: "user", content: "test message" }],
        clientSessionId
      );
      expect(session.setSessionId).toHaveBeenCalledWith(mockSessionId);
      expect(SessionTracker.trackSession).toHaveBeenCalledWith(mockSessionId, 1);
    });

    it("should generate new session ID when no client session provided", async () => {
      const session = createMockSession();
      const mockSessionId = "sess-generated-789";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      expect(SessionManager.getOrCreateSessionId).toHaveBeenCalledWith(1, expect.any(Array), null);
      expect(session.setSessionId).toHaveBeenCalledWith(mockSessionId);
    });

    it("should store session info with user and key details", async () => {
      const session = createMockSession();
      const mockSessionId = "sess-abc";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionMessages).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      expect(SessionManager.storeSessionInfo).toHaveBeenCalledWith(mockSessionId, {
        userName: "test-user",
        userId: 10,
        keyId: 1,
        keyName: "test-key",
        model: "claude-sonnet-4",
        apiType: "chat",
      });
    });

    it("should store session messages when messages are available", async () => {
      const session = createMockSession();
      const mockSessionId = "sess-xyz";
      const messages = [{ role: "user", content: "test" }];

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionMessages).mockResolvedValue(undefined);

      session.getMessages = vi.fn(() => messages);

      await ProxySessionGuard.ensure(session);

      expect(SessionManager.storeSessionMessages).toHaveBeenCalledWith(mockSessionId, messages);
    });

    it("should use codex API type for openai format requests", async () => {
      const session = createMockSession({
        originalFormat: "openai",
      });
      const mockSessionId = "sess-codex";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      expect(SessionManager.storeSessionInfo).toHaveBeenCalledWith(
        mockSessionId,
        expect.objectContaining({
          apiType: "codex",
        })
      );
    });

    it("should handle SessionManager errors gracefully with fallback session ID", async () => {
      const session = createMockSession();
      const fallbackSessionId = "sess-fallback-123";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockRejectedValue(
        new Error("Redis connection failed")
      );
      vi.mocked(SessionManager.generateSessionId).mockReturnValue(fallbackSessionId);

      await ProxySessionGuard.ensure(session);

      expect(logger.error).toHaveBeenCalledWith(
        "[ProxySessionGuard] Failed to assign session:",
        expect.any(Error)
      );
      expect(SessionManager.generateSessionId).toHaveBeenCalled();
      expect(session.setSessionId).toHaveBeenCalledWith(fallbackSessionId);
    });

    it("should handle SessionTracker.trackSession errors without blocking request", async () => {
      const session = createMockSession();
      const mockSessionId = "sess-track-error";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockRejectedValue(new Error("Redis tracking failed"));
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      // Should still set session ID despite tracking failure
      expect(session.setSessionId).toHaveBeenCalledWith(mockSessionId);
      expect(SessionTracker.trackSession).toHaveBeenCalled();
    });

    it("should handle storeSessionInfo errors without blocking request", async () => {
      const session = createMockSession();
      const mockSessionId = "sess-store-error";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockRejectedValue(
        new Error("Failed to store info")
      );

      await ProxySessionGuard.ensure(session);

      // Should still set session ID despite store failure
      expect(session.setSessionId).toHaveBeenCalledWith(mockSessionId);
    });

    it("should not store messages when getMessages returns null", async () => {
      const session = createMockSession({
        getMessages: vi.fn(() => null),
      });
      const mockSessionId = "sess-no-messages";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionMessages).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      expect(SessionManager.storeSessionMessages).not.toHaveBeenCalled();
    });

    it("should log debug message with session details on success", async () => {
      const session = createMockSession();
      const mockSessionId = "sess-debug-log";
      const clientSessionId = "client-123";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(clientSessionId);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("[ProxySessionGuard] Session assigned:")
      );
    });

    it("should handle missing authState.user gracefully", async () => {
      const session = createMockSession({
        authState: {
          key: { id: 1, name: "test-key" },
          user: null,
          apiKey: "test-api-key",
          success: true,
        },
      });
      const mockSessionId = "sess-no-user";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      // Should not call storeSessionInfo when user is missing
      expect(SessionManager.storeSessionInfo).not.toHaveBeenCalled();
      expect(session.setSessionId).toHaveBeenCalledWith(mockSessionId);
    });

    it("should handle missing authState.key gracefully", async () => {
      const session = createMockSession({
        authState: {
          key: null,
          user: { id: 10, name: "test-user" },
          apiKey: "test-api-key",
          success: true,
        },
      });

      await ProxySessionGuard.ensure(session);

      // Should skip session assignment when key is null
      expect(logger.warn).toHaveBeenCalledWith(
        "[ProxySessionGuard] No key ID, skipping session assignment"
      );
      expect(SessionManager.extractClientSessionId).not.toHaveBeenCalled();
      expect(session.setSessionId).not.toHaveBeenCalled();
    });

    it("should handle complex messages array correctly", async () => {
      const complexMessages = [
        { role: "user", content: "message 1" },
        { role: "assistant", content: "response 1" },
        { role: "user", content: "message 2" },
      ];
      const session = createMockSession({
        getMessages: vi.fn(() => complexMessages),
        getMessagesLength: vi.fn(() => complexMessages.length),
      });
      const mockSessionId = "sess-complex";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionMessages).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      expect(SessionManager.getOrCreateSessionId).toHaveBeenCalledWith(1, complexMessages, null);
      expect(SessionManager.storeSessionMessages).toHaveBeenCalledWith(
        mockSessionId,
        complexMessages
      );
    });

    it("should use client-provided session ID from metadata.user_id", async () => {
      const session = createMockSession();
      const clientSessionId = "user_session_abc123";
      const mockSessionId = "sess-reused";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(clientSessionId);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      expect(SessionManager.extractClientSessionId).toHaveBeenCalledWith(session.request.message);
      expect(SessionManager.getOrCreateSessionId).toHaveBeenCalledWith(
        1,
        expect.any(Array),
        clientSessionId
      );
    });

    it("should handle model being null in request", async () => {
      const session = createMockSession({
        request: {
          message: { messages: [] },
          model: null,
          log: "test log",
        },
      });
      const mockSessionId = "sess-null-model";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      expect(SessionManager.storeSessionInfo).toHaveBeenCalledWith(
        mockSessionId,
        expect.objectContaining({
          model: null,
        })
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty messages array", async () => {
      const session = createMockSession({
        getMessages: vi.fn(() => []),
        getMessagesLength: vi.fn(() => 0),
      });
      const mockSessionId = "sess-empty";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionMessages).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      expect(SessionManager.getOrCreateSessionId).toHaveBeenCalledWith(1, [], null);
      expect(session.setSessionId).toHaveBeenCalledWith(mockSessionId);
    });

    it("should handle undefined messages", async () => {
      const session = createMockSession({
        getMessages: vi.fn(() => undefined),
        getMessagesLength: vi.fn(() => 0),
      });
      const mockSessionId = "sess-undefined";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      expect(session.setSessionId).toHaveBeenCalledWith(mockSessionId);
      expect(SessionManager.storeSessionMessages).not.toHaveBeenCalled();
    });

    it("should not block on async storeSessionInfo errors", async () => {
      const session = createMockSession();
      const mockSessionId = "sess-async-error";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(mockSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockRejectedValue(new Error("Async error"));

      // Should complete without waiting for async operations
      await ProxySessionGuard.ensure(session);

      expect(session.setSessionId).toHaveBeenCalledWith(mockSessionId);
      // Logger.error will be called asynchronously, but we can't easily test it
    });
  });

  describe("Redis Atomicity and Concurrent Scenarios", () => {
    it("should handle concurrent session assignment attempts", async () => {
      const session1 = createMockSession();
      const session2 = createMockSession();
      const mockSessionId1 = "sess-concurrent-1";
      const mockSessionId2 = "sess-concurrent-2";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId)
        .mockResolvedValueOnce(mockSessionId1)
        .mockResolvedValueOnce(mockSessionId2);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);

      // Simulate concurrent requests
      await Promise.all([ProxySessionGuard.ensure(session1), ProxySessionGuard.ensure(session2)]);

      expect(session1.setSessionId).toHaveBeenCalledWith(mockSessionId1);
      expect(session2.setSessionId).toHaveBeenCalledWith(mockSessionId2);
      expect(SessionTracker.trackSession).toHaveBeenCalledTimes(2);
    });

    it("should handle Redis connection failures gracefully", async () => {
      const session = createMockSession();
      const fallbackSessionId = "sess-redis-fail";

      vi.mocked(SessionManager.extractClientSessionId).mockImplementation(() => {
        throw new Error("Redis connection lost");
      });
      vi.mocked(SessionManager.generateSessionId).mockReturnValue(fallbackSessionId);

      await ProxySessionGuard.ensure(session);

      expect(logger.error).toHaveBeenCalled();
      expect(session.setSessionId).toHaveBeenCalledWith(fallbackSessionId);
    });

    it("should handle timeout in session operations", async () => {
      const session = createMockSession();
      const fallbackSessionId = "sess-timeout";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(null);
      vi.mocked(SessionManager.getOrCreateSessionId).mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Operation timed out")), 100)
          )
      );
      vi.mocked(SessionManager.generateSessionId).mockReturnValue(fallbackSessionId);

      await ProxySessionGuard.ensure(session);

      expect(session.setSessionId).toHaveBeenCalledWith(fallbackSessionId);
    });
  });

  describe("Session Reuse Scenarios", () => {
    it("should reuse existing session when client provides session ID", async () => {
      const session = createMockSession();
      const clientSessionId = "existing-sess-123";

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(clientSessionId);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(clientSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      expect(SessionManager.getOrCreateSessionId).toHaveBeenCalledWith(
        1,
        expect.any(Array),
        clientSessionId
      );
      expect(session.setSessionId).toHaveBeenCalledWith(clientSessionId);
    });

    it("should track session correctly for reused sessions", async () => {
      const session = createMockSession();
      const clientSessionId = "reused-sess-456";
      const keyId = 1;

      vi.mocked(SessionManager.extractClientSessionId).mockReturnValue(clientSessionId);
      vi.mocked(SessionManager.getOrCreateSessionId).mockResolvedValue(clientSessionId);
      vi.mocked(SessionTracker.trackSession).mockResolvedValue(undefined);
      vi.mocked(SessionManager.storeSessionInfo).mockResolvedValue(undefined);

      await ProxySessionGuard.ensure(session);

      expect(SessionTracker.trackSession).toHaveBeenCalledWith(clientSessionId, keyId);
    });
  });
});
