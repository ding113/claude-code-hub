import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getTimeRangeForPeriod,
  getTTLForPeriod,
  getResetInfo,
  getSecondsUntilMidnight,
  getDailyResetTime,
} from "./time-utils";
import { getEnvConfig } from "@/lib/config";
import type { EnvConfig } from "@/lib/config/env.schema";

vi.mock("@/lib/config", () => ({
  getEnvConfig: vi.fn(),
}));

const getEnvConfigMock = vi.mocked(getEnvConfig);

function createEnvConfig(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return {
    NODE_ENV: "test",
    DSN: undefined,
    ADMIN_TOKEN: undefined,
    AUTO_MIGRATE: true,
    PORT: 23000,
    REDIS_URL: undefined,
    ENABLE_RATE_LIMIT: true,
    ENABLE_SECURE_COOKIES: true,
    SESSION_TTL: 300,
    DEBUG_MODE: false,
    LOG_LEVEL: "info",
    TZ: "Asia/Shanghai",
    ENABLE_MULTI_PROVIDER_TYPES: false,
    ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS: false,
    ALLOW_CROSS_GROUP_DEGRADE: undefined,
    FETCH_BODY_TIMEOUT: 120000,
    FETCH_HEADERS_TIMEOUT: 60000,
    FETCH_CONNECT_TIMEOUT: 30000,
    ENABLE_WEBSOCKET: true,
    WEBSOCKET_PATH: "/socket.io",
    APP_PORT: 23000,
    ...overrides,
  };
}

beforeEach(() => {
  getEnvConfigMock.mockReturnValue(createEnvConfig());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getTimeRangeForPeriod", () => {
  it("returns rolling 5-hour window for 5h period", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = getTimeRangeForPeriod("5h");

    expect(result.endTime).toEqual(now);
    expect(result.startTime.getTime()).toBe(now.getTime() - 5 * 60 * 60 * 1000);
    expect(result.startTime.toISOString()).toBe("2024-01-15T05:00:00.000Z");

    vi.useRealTimers();
  });

  it("returns current week start for weekly period", () => {
    // 2024-01-15 是周一
    const now = new Date("2024-01-15T10:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = getTimeRangeForPeriod("weekly");

    expect(result.endTime).toEqual(now);
    // 周一 00:00 (Asia/Shanghai = UTC+8)
    expect(result.startTime.toISOString()).toBe("2024-01-14T16:00:00.000Z"); // UTC时间

    vi.useRealTimers();
  });

  it("returns current month start for monthly period", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = getTimeRangeForPeriod("monthly");

    expect(result.endTime).toEqual(now);
    // 1月1日 00:00 (Asia/Shanghai = UTC+8)
    expect(result.startTime.toISOString()).toBe("2023-12-31T16:00:00.000Z"); // UTC时间

    vi.useRealTimers();
  });
});

describe("getTTLForPeriod", () => {
  it("returns 5 hours in seconds for 5h period", () => {
    const result = getTTLForPeriod("5h");
    expect(result).toBe(5 * 3600);
  });

  it("calculates seconds until next Monday for weekly period", () => {
    // 2024-01-15 周一 10:00
    const now = new Date("2024-01-15T02:00:00.000Z"); // UTC时间，Asia/Shanghai 10:00
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = getTTLForPeriod("weekly");

    // 到下周一 00:00 的秒数
    const nextMonday = new Date("2024-01-21T16:00:00.000Z"); // 下周一 00:00 Asia/Shanghai
    const expectedTTL = Math.ceil((nextMonday.getTime() - now.getTime()) / 1000);
    expect(result).toBe(expectedTTL);

    vi.useRealTimers();
  });

  it("calculates seconds until next month for monthly period", () => {
    // 2024-01-15 10:00
    const now = new Date("2024-01-15T02:00:00.000Z"); // UTC时间，Asia/Shanghai 10:00
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = getTTLForPeriod("monthly");

    // 到下月1日 00:00 的秒数
    const nextMonth = new Date("2024-01-31T16:00:00.000Z"); // 2月1日 00:00 Asia/Shanghai
    const expectedTTL = Math.ceil((nextMonth.getTime() - now.getTime()) / 1000);
    expect(result).toBe(expectedTTL);

    vi.useRealTimers();
  });
});

describe("getResetInfo", () => {
  it('returns rolling type for 5h period', () => {
    const result = getResetInfo("5h");

    expect(result.type).toBe("rolling");
    expect(result.period).toBe("5 小时");
    expect(result.resetAt).toBeUndefined();
  });

  it("returns natural type with resetAt for weekly period", () => {
    const now = new Date("2024-01-15T02:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = getResetInfo("weekly");

    expect(result.type).toBe("natural");
    expect(result.resetAt).toBeDefined();
    expect(result.resetAt?.toISOString()).toBe("2024-01-21T16:00:00.000Z");

    vi.useRealTimers();
  });

  it("returns natural type with resetAt for monthly period", () => {
    const now = new Date("2024-01-15T02:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = getResetInfo("monthly");

    expect(result.type).toBe("natural");
    expect(result.resetAt).toBeDefined();
    expect(result.resetAt?.toISOString()).toBe("2024-01-31T16:00:00.000Z");

    vi.useRealTimers();
  });
});

describe("getSecondsUntilMidnight", () => {
  it("calculates seconds until next midnight in Asia/Shanghai timezone", () => {
    // 2024-01-15 22:30:00 Asia/Shanghai
    const now = new Date("2024-01-15T14:30:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = getSecondsUntilMidnight();

    // 到 2024-01-16 00:00:00 Asia/Shanghai 的秒数 (1.5小时 = 5400秒)
    expect(result).toBe(5400);

    vi.useRealTimers();
  });

  it("returns full day seconds when at midnight", () => {
    // 2024-01-15 00:00:00 Asia/Shanghai
    const now = new Date("2024-01-14T16:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = getSecondsUntilMidnight();

    // 到下一个午夜 (24小时 = 86400秒)
    expect(result).toBe(86400);

    vi.useRealTimers();
  });
});

describe("getDailyResetTime", () => {
  it("returns next midnight in Asia/Shanghai timezone", () => {
    // 2024-01-15 22:30:00 Asia/Shanghai
    const now = new Date("2024-01-15T14:30:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = getDailyResetTime();

    // 下一个午夜 = 2024-01-16 00:00:00 Asia/Shanghai
    expect(result.toISOString()).toBe("2024-01-15T16:00:00.000Z");

    vi.useRealTimers();
  });
});
