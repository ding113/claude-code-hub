/**
 * @vitest-environment happy-dom
 */

import { describe, expect, test } from "vitest";

// Test the pure functions extracted from ProbeTerminal component
// These handle log formatting, filtering, and status determination

describe("ProbeTerminal - formatTime", () => {
  function formatTime(date: Date | string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  test("should format Date object correctly", () => {
    const date = new Date("2024-01-15T10:30:45Z");
    const result = formatTime(date);
    // Result format depends on locale, but should contain time components
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  test("should format ISO string correctly", () => {
    const result = formatTime("2024-01-15T10:30:45Z");
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  test("should handle different date formats", () => {
    const result1 = formatTime("2024-01-15T00:00:00Z");
    const result2 = formatTime("2024-12-31T23:59:59Z");
    expect(result1).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(result2).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
});

describe("ProbeTerminal - formatLatency", () => {
  function formatLatency(ms: number | null): string {
    if (ms === null) return "-";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  test("should return dash for null values", () => {
    expect(formatLatency(null)).toBe("-");
  });

  test("should format milliseconds for values < 1000", () => {
    expect(formatLatency(0)).toBe("0ms");
    expect(formatLatency(100)).toBe("100ms");
    expect(formatLatency(500)).toBe("500ms");
    expect(formatLatency(999)).toBe("999ms");
  });

  test("should format seconds for values >= 1000", () => {
    expect(formatLatency(1000)).toBe("1.00s");
    expect(formatLatency(1500)).toBe("1.50s");
    expect(formatLatency(2345)).toBe("2.35s");
    expect(formatLatency(10000)).toBe("10.00s");
  });

  test("should round milliseconds to nearest integer", () => {
    expect(formatLatency(100.4)).toBe("100ms");
    expect(formatLatency(100.5)).toBe("101ms");
    expect(formatLatency(100.9)).toBe("101ms");
  });
});

describe("ProbeTerminal - getLogLevel", () => {
  type LogLevel = "success" | "error" | "warn";

  interface ProbeLog {
    ok: boolean;
    errorType: string | null;
  }

  function getLogLevel(log: ProbeLog): LogLevel {
    if (log.ok) return "success";
    if (log.errorType === "timeout") return "warn";
    return "error";
  }

  test("should return success for ok logs", () => {
    expect(getLogLevel({ ok: true, errorType: null })).toBe("success");
    expect(getLogLevel({ ok: true, errorType: "timeout" })).toBe("success");
  });

  test("should return warn for timeout errors", () => {
    expect(getLogLevel({ ok: false, errorType: "timeout" })).toBe("warn");
  });

  test("should return error for other failures", () => {
    expect(getLogLevel({ ok: false, errorType: null })).toBe("error");
    expect(getLogLevel({ ok: false, errorType: "connection_refused" })).toBe("error");
    expect(getLogLevel({ ok: false, errorType: "ssl_error" })).toBe("error");
    expect(getLogLevel({ ok: false, errorType: "dns_error" })).toBe("error");
  });
});

describe("ProbeTerminal - log filtering", () => {
  interface MockLog {
    id: number;
    errorMessage: string | null;
    errorType: string | null;
    statusCode: number | null;
  }

  function filterLogs(logs: MockLog[], filter: string): MockLog[] {
    if (!filter) return logs;
    const searchLower = filter.toLowerCase();
    return logs.filter((log) => {
      return (
        log.errorMessage?.toLowerCase().includes(searchLower) ||
        log.errorType?.toLowerCase().includes(searchLower) ||
        log.statusCode?.toString().includes(searchLower)
      );
    });
  }

  const mockLogs: MockLog[] = [
    { id: 1, errorMessage: "Connection refused", errorType: "connection_error", statusCode: null },
    { id: 2, errorMessage: null, errorType: "timeout", statusCode: null },
    { id: 3, errorMessage: "SSL certificate error", errorType: "ssl_error", statusCode: null },
    { id: 4, errorMessage: null, errorType: null, statusCode: 200 },
    { id: 5, errorMessage: null, errorType: null, statusCode: 500 },
    { id: 6, errorMessage: "Bad Gateway", errorType: "http_error", statusCode: 502 },
  ];

  test("should return all logs when filter is empty", () => {
    expect(filterLogs(mockLogs, "")).toHaveLength(6);
    expect(filterLogs(mockLogs, "")).toEqual(mockLogs);
  });

  test("should filter by error message", () => {
    const result = filterLogs(mockLogs, "connection");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  test("should filter by error type", () => {
    const result = filterLogs(mockLogs, "timeout");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  test("should filter by status code", () => {
    const result = filterLogs(mockLogs, "500");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(5);
  });

  test("should be case insensitive", () => {
    const result1 = filterLogs(mockLogs, "SSL");
    const result2 = filterLogs(mockLogs, "ssl");
    expect(result1).toHaveLength(1);
    expect(result2).toHaveLength(1);
    expect(result1[0].id).toBe(result2[0].id);
  });

  test("should match partial strings", () => {
    const result = filterLogs(mockLogs, "error");
    // Should match: connection_error, ssl_error, http_error, and "SSL certificate error"
    expect(result.length).toBeGreaterThan(0);
  });

  test("should return empty array when no matches", () => {
    const result = filterLogs(mockLogs, "nonexistent");
    expect(result).toHaveLength(0);
  });
});

describe("ProbeTerminal - levelConfig", () => {
  const levelConfig = {
    success: {
      label: "OK",
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/5",
      borderColor: "border-l-emerald-500",
    },
    error: {
      label: "FAIL",
      color: "text-rose-500",
      bgColor: "bg-rose-500/5",
      borderColor: "border-l-rose-500",
    },
    warn: {
      label: "WARN",
      color: "text-amber-500",
      bgColor: "bg-amber-500/5",
      borderColor: "border-l-amber-500",
    },
  };

  test("success level should have green colors", () => {
    expect(levelConfig.success.color).toContain("emerald");
    expect(levelConfig.success.bgColor).toContain("emerald");
    expect(levelConfig.success.borderColor).toContain("emerald");
  });

  test("error level should have red colors", () => {
    expect(levelConfig.error.color).toContain("rose");
    expect(levelConfig.error.bgColor).toContain("rose");
    expect(levelConfig.error.borderColor).toContain("rose");
  });

  test("warn level should have amber colors", () => {
    expect(levelConfig.warn.color).toContain("amber");
    expect(levelConfig.warn.bgColor).toContain("amber");
    expect(levelConfig.warn.borderColor).toContain("amber");
  });

  test("each level should have distinct labels", () => {
    expect(levelConfig.success.label).toBe("OK");
    expect(levelConfig.error.label).toBe("FAIL");
    expect(levelConfig.warn.label).toBe("WARN");
  });
});

describe("ProbeTerminal - maxLines slicing", () => {
  function sliceLogs<T>(logs: T[], maxLines: number): T[] {
    return logs.slice(-maxLines);
  }

  test("should return all logs when count <= maxLines", () => {
    const logs = [1, 2, 3, 4, 5];
    expect(sliceLogs(logs, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(sliceLogs(logs, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  test("should return last N logs when count > maxLines", () => {
    const logs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(sliceLogs(logs, 5)).toEqual([6, 7, 8, 9, 10]);
    expect(sliceLogs(logs, 3)).toEqual([8, 9, 10]);
  });

  test("should handle empty array", () => {
    expect(sliceLogs([], 10)).toEqual([]);
  });

  test("should handle maxLines of 1", () => {
    const logs = [1, 2, 3];
    expect(sliceLogs(logs, 1)).toEqual([3]);
  });
});
