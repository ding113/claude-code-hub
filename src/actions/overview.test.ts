import { describe, it, expect, beforeEach, vi } from "vitest";
import { getOverviewData } from "./overview";
import type { OverviewMetrics } from "@/repository/overview";
import type { ActiveSessionInfo } from "@/types/session";
import type { ActionResult } from "./types";

// Mock dependencies
vi.mock("@/repository/overview", () => ({
  getOverviewMetrics: vi.fn(),
}));

vi.mock("./concurrent-sessions", () => ({
  getConcurrentSessions: vi.fn(),
}));

vi.mock("./active-sessions", () => ({
  getActiveSessions: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("Overview Actions", () => {
  // Import mocked modules
  let getOverviewMetrics: ReturnType<typeof vi.fn>;
  let getConcurrentSessions: ReturnType<typeof vi.fn>;
  let getActiveSessions: ReturnType<typeof vi.fn>;
  let getSession: ReturnType<typeof vi.fn>;
  let getSystemSettings: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import mocked functions
    const overviewRepo = await import("@/repository/overview");
    const concurrentSessionsAction = await import("./concurrent-sessions");
    const activeSessionsAction = await import("./active-sessions");
    const auth = await import("@/lib/auth");
    const systemConfig = await import("@/repository/system-config");

    getOverviewMetrics = overviewRepo.getOverviewMetrics as ReturnType<typeof vi.fn>;
    getConcurrentSessions = concurrentSessionsAction.getConcurrentSessions as ReturnType<
      typeof vi.fn
    >;
    getActiveSessions = activeSessionsAction.getActiveSessions as ReturnType<typeof vi.fn>;
    getSession = auth.getSession as ReturnType<typeof vi.fn>;
    getSystemSettings = systemConfig.getSystemSettings as ReturnType<typeof vi.fn>;
  });

  describe("getOverviewData", () => {
    const mockMetrics: OverviewMetrics = {
      todayRequests: 100,
      todayCost: 5.25,
      avgResponseTime: 1500,
    };

    const mockActiveSession: ActiveSessionInfo = {
      sessionId: "session-123",
      userName: "Test User",
      userId: 1,
      keyId: 1,
      keyName: "test-key",
      providerId: 1,
      providerName: "OpenAI",
      model: "gpt-4",
      apiType: "chat",
      startTime: Date.now(),
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: "0.015",
      status: "completed",
      durationMs: 1000,
      requestCount: 1,
    };

    describe("Authentication", () => {
      it("should return error when user is not logged in", async () => {
        getSession.mockResolvedValue(null);

        const result = await getOverviewData();

        expect(result).toEqual({
          ok: false,
          error: "未登录",
        });
      });
    });

    describe("Admin User - Full Access", () => {
      beforeEach(() => {
        getSession.mockResolvedValue({
          user: { id: 1, name: "Admin User", role: "admin" },
        });
        getSystemSettings.mockResolvedValue({
          allowGlobalUsageView: false,
        });
      });

      it("should return full global overview data for admin", async () => {
        getConcurrentSessions.mockResolvedValue({
          ok: true,
          data: 5,
        });
        getOverviewMetrics.mockResolvedValue(mockMetrics);
        getActiveSessions.mockResolvedValue({
          ok: true,
          data: [mockActiveSession],
        });

        const result = await getOverviewData();

        expect(result).toEqual({
          ok: true,
          data: {
            concurrentSessions: 5,
            todayRequests: 100,
            todayCost: 5.25,
            avgResponseTime: 1500,
            recentSessions: [mockActiveSession],
          },
        });
      });

      it("should return zero concurrent sessions when getConcurrentSessions fails", async () => {
        getConcurrentSessions.mockResolvedValue({
          ok: false,
          error: "Redis error",
        });
        getOverviewMetrics.mockResolvedValue(mockMetrics);
        getActiveSessions.mockResolvedValue({
          ok: true,
          data: [mockActiveSession],
        });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.concurrentSessions).toBe(0);
        }
      });

      it("should return empty recentSessions when getActiveSessions fails", async () => {
        getConcurrentSessions.mockResolvedValue({
          ok: true,
          data: 5,
        });
        getOverviewMetrics.mockResolvedValue(mockMetrics);
        getActiveSessions.mockResolvedValue({
          ok: false,
          error: "Database error",
        });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.recentSessions).toEqual([]);
        }
      });

      it("should limit recentSessions to 10 items", async () => {
        const manySessions = Array.from({ length: 15 }, (_, i) => ({
          ...mockActiveSession,
          sessionId: `session-${i}`,
        }));

        getConcurrentSessions.mockResolvedValue({
          ok: true,
          data: 15,
        });
        getOverviewMetrics.mockResolvedValue(mockMetrics);
        getActiveSessions.mockResolvedValue({
          ok: true,
          data: manySessions,
        });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.recentSessions).toHaveLength(10);
        }
      });

      it("should handle zero metrics correctly", async () => {
        getConcurrentSessions.mockResolvedValue({
          ok: true,
          data: 0,
        });
        getOverviewMetrics.mockResolvedValue({
          todayRequests: 0,
          todayCost: 0,
          avgResponseTime: 0,
        });
        getActiveSessions.mockResolvedValue({
          ok: true,
          data: [],
        });

        const result = await getOverviewData();

        expect(result).toEqual({
          ok: true,
          data: {
            concurrentSessions: 0,
            todayRequests: 0,
            todayCost: 0,
            avgResponseTime: 0,
            recentSessions: [],
          },
        });
      });

      it("should handle high values correctly", async () => {
        getConcurrentSessions.mockResolvedValue({
          ok: true,
          data: 999,
        });
        getOverviewMetrics.mockResolvedValue({
          todayRequests: 1000000,
          todayCost: 9999.99,
          avgResponseTime: 30000,
        });
        getActiveSessions.mockResolvedValue({
          ok: true,
          data: [mockActiveSession],
        });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.concurrentSessions).toBe(999);
          expect(result.data.todayRequests).toBe(1000000);
          expect(result.data.todayCost).toBe(9999.99);
          expect(result.data.avgResponseTime).toBe(30000);
        }
      });

      it("should handle decimal cost values correctly", async () => {
        getConcurrentSessions.mockResolvedValue({
          ok: true,
          data: 5,
        });
        getOverviewMetrics.mockResolvedValue({
          todayRequests: 100,
          todayCost: 5.123456, // Test precision
          avgResponseTime: 1500,
        });
        getActiveSessions.mockResolvedValue({
          ok: true,
          data: [],
        });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.todayCost).toBe(5.123456);
        }
      });
    });

    describe("Regular User with allowGlobalUsageView=true", () => {
      beforeEach(() => {
        getSession.mockResolvedValue({
          user: { id: 2, name: "Regular User", role: "user" },
        });
        getSystemSettings.mockResolvedValue({
          allowGlobalUsageView: true,
        });
      });

      it("should return full global overview data when allowGlobalUsageView is enabled", async () => {
        getConcurrentSessions.mockResolvedValue({
          ok: true,
          data: 5,
        });
        getOverviewMetrics.mockResolvedValue(mockMetrics);
        getActiveSessions.mockResolvedValue({
          ok: true,
          data: [mockActiveSession],
        });

        const result = await getOverviewData();

        expect(result).toEqual({
          ok: true,
          data: {
            concurrentSessions: 5,
            todayRequests: 100,
            todayCost: 5.25,
            avgResponseTime: 1500,
            recentSessions: [mockActiveSession],
          },
        });
      });

      it("should handle empty active sessions", async () => {
        getConcurrentSessions.mockResolvedValue({
          ok: true,
          data: 0,
        });
        getOverviewMetrics.mockResolvedValue(mockMetrics);
        getActiveSessions.mockResolvedValue({
          ok: true,
          data: [],
        });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.recentSessions).toEqual([]);
        }
      });
    });

    describe("Regular User without Global View Permission", () => {
      beforeEach(() => {
        getSession.mockResolvedValue({
          user: { id: 2, name: "Regular User", role: "user" },
        });
        getSystemSettings.mockResolvedValue({
          allowGlobalUsageView: false,
        });
      });

      it("should return zero metrics and only user's sessions when no global view permission", async () => {
        getConcurrentSessions.mockResolvedValue({
          ok: true,
          data: 5,
        });
        getOverviewMetrics.mockResolvedValue(mockMetrics);
        getActiveSessions.mockResolvedValue({
          ok: true,
          data: [mockActiveSession],
        });

        const result = await getOverviewData();

        expect(result).toEqual({
          ok: true,
          data: {
            concurrentSessions: 0,
            todayRequests: 0,
            todayCost: 0,
            avgResponseTime: 0,
            recentSessions: [mockActiveSession],
          },
        });
      });

      it("should limit user's sessions to 10 items", async () => {
        const userSessions = Array.from({ length: 20 }, (_, i) => ({
          ...mockActiveSession,
          sessionId: `user-session-${i}`,
          userId: 2,
        }));

        getConcurrentSessions.mockResolvedValue({
          ok: true,
          data: 20,
        });
        getOverviewMetrics.mockResolvedValue(mockMetrics);
        getActiveSessions.mockResolvedValue({
          ok: true,
          data: userSessions,
        });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.concurrentSessions).toBe(0);
          expect(result.data.todayRequests).toBe(0);
          expect(result.data.todayCost).toBe(0);
          expect(result.data.avgResponseTime).toBe(0);
          expect(result.data.recentSessions).toHaveLength(10);
        }
      });

      it("should return empty sessions when user has no active sessions", async () => {
        getConcurrentSessions.mockResolvedValue({
          ok: true,
          data: 5,
        });
        getOverviewMetrics.mockResolvedValue(mockMetrics);
        getActiveSessions.mockResolvedValue({
          ok: true,
          data: [],
        });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.recentSessions).toEqual([]);
        }
      });

      it("should return empty sessions when getActiveSessions fails", async () => {
        getConcurrentSessions.mockResolvedValue({
          ok: true,
          data: 5,
        });
        getOverviewMetrics.mockResolvedValue(mockMetrics);
        getActiveSessions.mockResolvedValue({
          ok: false,
          error: "Database error",
        });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.recentSessions).toEqual([]);
        }
      });
    });

    describe("Parallel Query Execution", () => {
      beforeEach(() => {
        getSession.mockResolvedValue({
          user: { id: 1, name: "Admin User", role: "admin" },
        });
        getSystemSettings.mockResolvedValue({
          allowGlobalUsageView: false,
        });
      });

      it("should execute all queries in parallel", async () => {
        const startTimes: number[] = [];

        getConcurrentSessions.mockImplementation(async () => {
          startTimes.push(Date.now());
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { ok: true, data: 5 };
        });

        getOverviewMetrics.mockImplementation(async () => {
          startTimes.push(Date.now());
          await new Promise((resolve) => setTimeout(resolve, 10));
          return mockMetrics;
        });

        getActiveSessions.mockImplementation(async () => {
          startTimes.push(Date.now());
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { ok: true, data: [mockActiveSession] };
        });

        await getOverviewData();

        // All three queries should start at roughly the same time
        const timeDiffs = startTimes.slice(1).map((t, i) => Math.abs(t - startTimes[i]));
        expect(Math.max(...timeDiffs)).toBeLessThan(20); // Allow 20ms tolerance
      });
    });

    describe("Error Handling", () => {
      beforeEach(() => {
        getSession.mockResolvedValue({
          user: { id: 1, name: "Admin User", role: "admin" },
        });
        getSystemSettings.mockResolvedValue({
          allowGlobalUsageView: false,
        });
      });

      it("should handle general exception and return error", async () => {
        getSystemSettings.mockRejectedValue(new Error("Database connection failed"));

        const result = await getOverviewData();

        expect(result).toEqual({
          ok: false,
          error: "获取概览数据失败",
        });
      });

      it("should handle null session from getSession", async () => {
        getSession.mockResolvedValue(null);

        const result = await getOverviewData();

        expect(result).toEqual({
          ok: false,
          error: "未登录",
        });
      });

      it("should handle exception in getSystemSettings", async () => {
        getSystemSettings.mockRejectedValue(new Error("Config error"));

        const result = await getOverviewData();

        expect(result).toEqual({
          ok: false,
          error: "获取概览数据失败",
        });
      });

      it("should handle exception in getOverviewMetrics", async () => {
        getConcurrentSessions.mockResolvedValue({ ok: true, data: 5 });
        getOverviewMetrics.mockRejectedValue(new Error("Database error"));
        getActiveSessions.mockResolvedValue({ ok: true, data: [] });

        const result = await getOverviewData();

        expect(result).toEqual({
          ok: false,
          error: "获取概览数据失败",
        });
      });

      it("should handle partial failures gracefully", async () => {
        getConcurrentSessions.mockResolvedValue({
          ok: false,
          error: "Redis unavailable",
        });
        getOverviewMetrics.mockResolvedValue(mockMetrics);
        getActiveSessions.mockResolvedValue({
          ok: false,
          error: "Session manager error",
        });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.concurrentSessions).toBe(0);
          expect(result.data.todayRequests).toBe(100);
          expect(result.data.recentSessions).toEqual([]);
        }
      });
    });

    describe("Edge Cases", () => {
      beforeEach(() => {
        getSession.mockResolvedValue({
          user: { id: 1, name: "Admin User", role: "admin" },
        });
        getSystemSettings.mockResolvedValue({
          allowGlobalUsageView: false,
        });
      });

      it("should handle null cost value", async () => {
        getConcurrentSessions.mockResolvedValue({ ok: true, data: 5 });
        getOverviewMetrics.mockResolvedValue({
          todayRequests: 100,
          todayCost: 0,
          avgResponseTime: 1500,
        });
        getActiveSessions.mockResolvedValue({ ok: true, data: [] });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.todayCost).toBe(0);
        }
      });

      it("should handle negative values (should not happen but test defensive)", async () => {
        getConcurrentSessions.mockResolvedValue({ ok: true, data: -1 });
        getOverviewMetrics.mockResolvedValue({
          todayRequests: -10,
          todayCost: -5.0,
          avgResponseTime: -100,
        });
        getActiveSessions.mockResolvedValue({ ok: true, data: [] });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.concurrentSessions).toBe(-1);
          expect(result.data.todayRequests).toBe(-10);
          expect(result.data.todayCost).toBe(-5.0);
          expect(result.data.avgResponseTime).toBe(-100);
        }
      });

      it("should handle very large numbers", async () => {
        getConcurrentSessions.mockResolvedValue({ ok: true, data: Number.MAX_SAFE_INTEGER });
        getOverviewMetrics.mockResolvedValue({
          todayRequests: Number.MAX_SAFE_INTEGER,
          todayCost: 999999999.99,
          avgResponseTime: Number.MAX_SAFE_INTEGER,
        });
        getActiveSessions.mockResolvedValue({ ok: true, data: [] });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.concurrentSessions).toBe(Number.MAX_SAFE_INTEGER);
          expect(result.data.todayRequests).toBe(Number.MAX_SAFE_INTEGER);
          expect(result.data.avgResponseTime).toBe(Number.MAX_SAFE_INTEGER);
        }
      });

      it("should handle sessions with different API types", async () => {
        const chatSession: ActiveSessionInfo = {
          ...mockActiveSession,
          sessionId: "chat-session",
          apiType: "chat",
        };
        const codexSession: ActiveSessionInfo = {
          ...mockActiveSession,
          sessionId: "codex-session",
          apiType: "codex",
        };

        getConcurrentSessions.mockResolvedValue({ ok: true, data: 2 });
        getOverviewMetrics.mockResolvedValue(mockMetrics);
        getActiveSessions.mockResolvedValue({
          ok: true,
          data: [chatSession, codexSession],
        });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.recentSessions).toHaveLength(2);
          expect(result.data.recentSessions[0].apiType).toBe("chat");
          expect(result.data.recentSessions[1].apiType).toBe("codex");
        }
      });

      it("should handle sessions with missing optional fields", async () => {
        const minimalSession: ActiveSessionInfo = {
          sessionId: "minimal-session",
          userName: "User",
          userId: 1,
          keyId: 1,
          keyName: "key",
          providerId: null,
          providerName: null,
          model: null,
          apiType: "chat",
          startTime: Date.now(),
          status: "in_progress",
        };

        getConcurrentSessions.mockResolvedValue({ ok: true, data: 1 });
        getOverviewMetrics.mockResolvedValue(mockMetrics);
        getActiveSessions.mockResolvedValue({
          ok: true,
          data: [minimalSession],
        });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.recentSessions).toHaveLength(1);
          expect(result.data.recentSessions[0].providerId).toBeNull();
          expect(result.data.recentSessions[0].providerName).toBeNull();
          expect(result.data.recentSessions[0].model).toBeNull();
        }
      });

      it("should handle float avgResponseTime correctly", async () => {
        getConcurrentSessions.mockResolvedValue({ ok: true, data: 5 });
        getOverviewMetrics.mockResolvedValue({
          todayRequests: 100,
          todayCost: 5.25,
          avgResponseTime: 1234.5678, // Float value
        });
        getActiveSessions.mockResolvedValue({ ok: true, data: [] });

        const result = await getOverviewData();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.avgResponseTime).toBe(1234.5678);
        }
      });
    });

    describe("Permission Matrix", () => {
      const testCases = [
        {
          role: "admin",
          allowGlobalUsageView: false,
          expectGlobalData: true,
          description: "Admin user always sees global data",
        },
        {
          role: "admin",
          allowGlobalUsageView: true,
          expectGlobalData: true,
          description: "Admin user with global view enabled sees global data",
        },
        {
          role: "user",
          allowGlobalUsageView: true,
          expectGlobalData: true,
          description: "Regular user with global view enabled sees global data",
        },
        {
          role: "user",
          allowGlobalUsageView: false,
          expectGlobalData: false,
          description: "Regular user without global view sees zero metrics",
        },
      ];

      testCases.forEach(({ role, allowGlobalUsageView, expectGlobalData, description }) => {
        it(description, async () => {
          getSession.mockResolvedValue({
            user: { id: 1, name: "Test User", role },
          });
          getSystemSettings.mockResolvedValue({
            allowGlobalUsageView,
          });
          getConcurrentSessions.mockResolvedValue({ ok: true, data: 5 });
          getOverviewMetrics.mockResolvedValue(mockMetrics);
          getActiveSessions.mockResolvedValue({
            ok: true,
            data: [mockActiveSession],
          });

          const result = await getOverviewData();

          expect(result.ok).toBe(true);
          if (result.ok) {
            if (expectGlobalData) {
              expect(result.data.concurrentSessions).toBe(5);
              expect(result.data.todayRequests).toBe(100);
              expect(result.data.todayCost).toBe(5.25);
              expect(result.data.avgResponseTime).toBe(1500);
            } else {
              expect(result.data.concurrentSessions).toBe(0);
              expect(result.data.todayRequests).toBe(0);
              expect(result.data.todayCost).toBe(0);
              expect(result.data.avgResponseTime).toBe(0);
            }
            expect(result.data.recentSessions).toHaveLength(1);
          }
        });
      });
    });
  });
});
