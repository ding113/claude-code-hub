import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  getSessionDisplayStatus,
  SESSION_DISPLAY_STATUS,
  type SessionStatusInput,
} from "@/lib/session-status";

describe("Session Status Logic", () => {
  describe("getSessionDisplayStatus", () => {
    test("IDLE: concurrentCount is 0 with no requests", () => {
      const input: SessionStatusInput = {
        concurrentCount: 0,
        requestCount: 0,
        status: "completed",
      };

      const result = getSessionDisplayStatus(input);

      expect(result.status).toBe(SESSION_DISPLAY_STATUS.IDLE);
      expect(result.label).toBe("IDLE");
      expect(result.pulse).toBe(false);
      expect(result.tooltipKey).toBe("status.idleTooltip");
    });

    test("IDLE: concurrentCount is 0 with completed requests", () => {
      const input: SessionStatusInput = {
        concurrentCount: 0,
        requestCount: 5,
        status: "completed",
      };

      const result = getSessionDisplayStatus(input);

      expect(result.status).toBe(SESSION_DISPLAY_STATUS.IDLE);
      expect(result.label).toBe("IDLE");
      expect(result.pulse).toBe(false);
    });

    test("INITIALIZING: first request still running (requestCount=0, concurrentCount>0)", () => {
      const input: SessionStatusInput = {
        concurrentCount: 1,
        requestCount: 0,
        status: "in_progress",
      };

      const result = getSessionDisplayStatus(input);

      expect(result.status).toBe(SESSION_DISPLAY_STATUS.INITIALIZING);
      expect(result.label).toBe("INIT");
      expect(result.pulse).toBe(true);
      expect(result.tooltipKey).toBe("status.initializingTooltip");
      expect(result.color).toContain("amber");
    });

    test("INITIALIZING: first request still running (requestCount=1, concurrentCount>0)", () => {
      const input: SessionStatusInput = {
        concurrentCount: 1,
        requestCount: 1,
        status: "in_progress",
      };

      const result = getSessionDisplayStatus(input);

      expect(result.status).toBe(SESSION_DISPLAY_STATUS.INITIALIZING);
      expect(result.label).toBe("INIT");
      expect(result.pulse).toBe(true);
    });

    test("IN_PROGRESS: has active requests after first (requestCount>1, concurrentCount>0)", () => {
      const input: SessionStatusInput = {
        concurrentCount: 2,
        requestCount: 5,
        status: "in_progress",
      };

      const result = getSessionDisplayStatus(input);

      expect(result.status).toBe(SESSION_DISPLAY_STATUS.IN_PROGRESS);
      expect(result.label).toBe("BUSY");
      expect(result.pulse).toBe(true);
      expect(result.tooltipKey).toBe("status.inProgressTooltip");
      expect(result.color).toContain("emerald");
    });

    test("IN_PROGRESS: single active request after first completed", () => {
      const input: SessionStatusInput = {
        concurrentCount: 1,
        requestCount: 2,
        status: "in_progress",
      };

      const result = getSessionDisplayStatus(input);

      expect(result.status).toBe(SESSION_DISPLAY_STATUS.IN_PROGRESS);
      expect(result.label).toBe("BUSY");
      expect(result.pulse).toBe(true);
    });

    test("ERROR: status is error takes priority", () => {
      const input: SessionStatusInput = {
        concurrentCount: 1,
        requestCount: 3,
        status: "error",
      };

      const result = getSessionDisplayStatus(input);

      expect(result.status).toBe(SESSION_DISPLAY_STATUS.IN_PROGRESS);
      expect(result.label).toBe("FAIL");
      expect(result.pulse).toBe(true);
      expect(result.tooltipKey).toBe("status.errorTooltip");
      expect(result.color).toContain("rose");
    });

    test("ERROR: status is error even with no concurrent requests", () => {
      const input: SessionStatusInput = {
        concurrentCount: 0,
        requestCount: 5,
        status: "error",
      };

      const result = getSessionDisplayStatus(input);

      expect(result.label).toBe("FAIL");
      expect(result.pulse).toBe(true);
    });

    test("handles undefined values with defaults", () => {
      const input: SessionStatusInput = {};

      const result = getSessionDisplayStatus(input);

      expect(result.status).toBe(SESSION_DISPLAY_STATUS.IDLE);
      expect(result.label).toBe("IDLE");
      expect(result.pulse).toBe(false);
    });

    test("handles partial input with only concurrentCount", () => {
      const input: SessionStatusInput = {
        concurrentCount: 1,
      };

      const result = getSessionDisplayStatus(input);

      expect(result.status).toBe(SESSION_DISPLAY_STATUS.INITIALIZING);
      expect(result.label).toBe("INIT");
    });

    test("handles partial input with only requestCount", () => {
      const input: SessionStatusInput = {
        requestCount: 10,
      };

      const result = getSessionDisplayStatus(input);

      expect(result.status).toBe(SESSION_DISPLAY_STATUS.IDLE);
      expect(result.label).toBe("IDLE");
    });

    test("high concurrency scenario", () => {
      const input: SessionStatusInput = {
        concurrentCount: 50,
        requestCount: 100,
        status: "in_progress",
      };

      const result = getSessionDisplayStatus(input);

      expect(result.status).toBe(SESSION_DISPLAY_STATUS.IN_PROGRESS);
      expect(result.label).toBe("BUSY");
      expect(result.pulse).toBe(true);
    });
  });

  describe("SESSION_DISPLAY_STATUS constants", () => {
    test("constants are uppercase strings", () => {
      expect(SESSION_DISPLAY_STATUS.IN_PROGRESS).toBe("IN_PROGRESS");
      expect(SESSION_DISPLAY_STATUS.IDLE).toBe("IDLE");
      expect(SESSION_DISPLAY_STATUS.INITIALIZING).toBe("INITIALIZING");
    });

    test("constants are readonly", () => {
      expect(Object.isFrozen(SESSION_DISPLAY_STATUS)).toBe(false);
      expect(typeof SESSION_DISPLAY_STATUS).toBe("object");
    });
  });

  describe("status transition scenarios", () => {
    test("session lifecycle: new -> initializing -> in_progress -> idle", () => {
      // New session, no requests yet
      const newSession: SessionStatusInput = {
        concurrentCount: 0,
        requestCount: 0,
      };
      expect(getSessionDisplayStatus(newSession).status).toBe(SESSION_DISPLAY_STATUS.IDLE);

      // First request starts
      const initializing: SessionStatusInput = {
        concurrentCount: 1,
        requestCount: 0,
      };
      expect(getSessionDisplayStatus(initializing).status).toBe(
        SESSION_DISPLAY_STATUS.INITIALIZING
      );

      // First request completes, second starts
      const inProgress: SessionStatusInput = {
        concurrentCount: 1,
        requestCount: 2,
      };
      expect(getSessionDisplayStatus(inProgress).status).toBe(SESSION_DISPLAY_STATUS.IN_PROGRESS);

      // All requests complete
      const idle: SessionStatusInput = {
        concurrentCount: 0,
        requestCount: 10,
      };
      expect(getSessionDisplayStatus(idle).status).toBe(SESSION_DISPLAY_STATUS.IDLE);
    });

    test("error can occur at any stage", () => {
      const errorDuringInit: SessionStatusInput = {
        concurrentCount: 1,
        requestCount: 0,
        status: "error",
      };
      expect(getSessionDisplayStatus(errorDuringInit).label).toBe("FAIL");

      const errorDuringProgress: SessionStatusInput = {
        concurrentCount: 3,
        requestCount: 10,
        status: "error",
      };
      expect(getSessionDisplayStatus(errorDuringProgress).label).toBe("FAIL");

      const errorAfterComplete: SessionStatusInput = {
        concurrentCount: 0,
        requestCount: 5,
        status: "error",
      };
      expect(getSessionDisplayStatus(errorAfterComplete).label).toBe("FAIL");
    });
  });
});
