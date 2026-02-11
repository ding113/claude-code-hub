import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CircuitBreakerAlertData } from "@/lib/webhook/types";

describe("sendCircuitBreakerAlert", () => {
  const mockRedisGet = vi.fn();
  const mockRedisSet = vi.fn();
  const mockAddNotificationJob = vi.fn(async () => {});
  const mockAddNotificationJobForTarget = vi.fn(async () => {});

  beforeEach(() => {
    vi.resetModules();

    vi.doMock("@/lib/redis/client", () => ({
      getRedisClient: vi.fn(() => ({
        get: mockRedisGet,
        set: mockRedisSet,
      })),
    }));

    vi.doMock("@/repository/notifications", () => ({
      getNotificationSettings: vi.fn(async () => ({
        enabled: true,
        circuitBreakerEnabled: true,
        useLegacyMode: true,
        circuitBreakerWebhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
      })),
    }));

    vi.doMock("@/lib/notification/notification-queue", () => ({
      addNotificationJob: mockAddNotificationJob,
      addNotificationJobForTarget: mockAddNotificationJobForTarget,
    }));

    vi.doMock("@/lib/logger", () => ({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
      },
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("dedup key with incidentSource", () => {
    it("should use provider dedup key when incidentSource is provider", async () => {
      mockRedisGet.mockResolvedValue(null); // No cached alert

      const { sendCircuitBreakerAlert } = await import("@/lib/notification/notifier");

      const data: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 5,
        retryAt: "2025-01-02T12:30:00Z",
        incidentSource: "provider",
      };

      await sendCircuitBreakerAlert(data);

      // Should use dedup key with provider source
      expect(mockRedisSet).toHaveBeenCalledWith("circuit-breaker-alert:1:provider", "1", "EX", 300);
    });

    it("should use endpoint dedup key when incidentSource is endpoint", async () => {
      mockRedisGet.mockResolvedValue(null);

      const { sendCircuitBreakerAlert } = await import("@/lib/notification/notifier");

      const data: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
        incidentSource: "endpoint",
        endpointId: 42,
        endpointUrl: "https://api.openai.com/v1",
      };

      await sendCircuitBreakerAlert(data);

      // Should use dedup key with endpoint source including endpointId
      expect(mockRedisSet).toHaveBeenCalledWith(
        "circuit-breaker-alert:1:endpoint:42",
        "1",
        "EX",
        300
      );
    });

    it("should dedup independently for same provider with different sources", async () => {
      // Provider alert is cached
      mockRedisGet.mockResolvedValueOnce("1");
      // Endpoint alert is NOT cached
      mockRedisGet.mockResolvedValueOnce(null);

      const { sendCircuitBreakerAlert } = await import("@/lib/notification/notifier");

      const providerData: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 5,
        retryAt: "2025-01-02T12:30:00Z",
        incidentSource: "provider",
      };

      const endpointData: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
        incidentSource: "endpoint",
        endpointId: 42,
        endpointUrl: "https://api.openai.com/v1",
      };

      await sendCircuitBreakerAlert(providerData);
      await sendCircuitBreakerAlert(endpointData);

      // Provider alert should be suppressed (cached)
      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      // That one call should be for endpoint source
      expect(mockRedisSet).toHaveBeenCalledWith(
        "circuit-breaker-alert:1:endpoint:42",
        "1",
        "EX",
        300
      );
    });

    it("should default to provider source when incidentSource is undefined", async () => {
      mockRedisGet.mockResolvedValue(null);

      const { sendCircuitBreakerAlert } = await import("@/lib/notification/notifier");

      const data: CircuitBreakerAlertData = {
        providerName: "Anthropic",
        providerId: 2,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
        // incidentSource is undefined - should default to provider
      };

      await sendCircuitBreakerAlert(data);

      // Should use dedup key with default provider source
      expect(mockRedisSet).toHaveBeenCalledWith("circuit-breaker-alert:2:provider", "1", "EX", 300);
    });

    it("should suppress endpoint alert when same endpointId was recently alerted", async () => {
      // First call: not cached
      mockRedisGet.mockResolvedValueOnce(null);
      // Second call: cached
      mockRedisGet.mockResolvedValueOnce("1");

      const { sendCircuitBreakerAlert } = await import("@/lib/notification/notifier");

      const data: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
        incidentSource: "endpoint",
        endpointId: 42,
      };

      await sendCircuitBreakerAlert(data);
      await sendCircuitBreakerAlert(data);

      // Only first call should have set cache
      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      // Should have checked cache twice
      expect(mockRedisGet).toHaveBeenCalledTimes(2);
    });
  });
});
