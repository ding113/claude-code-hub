import { describe, expect, test } from "vitest";
import {
  buildLogsUrlQuery,
  parseLogsUrlFilters,
} from "@/app/[locale]/dashboard/logs/_utils/logs-query";

describe("dashboard logs url query utils", () => {
  test("parses and trims sessionId", () => {
    const parsed = parseLogsUrlFilters({ sessionId: "  abc  " });
    expect(parsed.sessionId).toBe("abc");
  });

  test("array params use the first value", () => {
    const parsed = parseLogsUrlFilters({
      sessionId: ["  abc  ", "ignored"],
      userId: ["1", "2"],
      statusCode: ["!200", "200"],
    });
    expect(parsed.sessionId).toBe("abc");
    expect(parsed.userId).toBe(1);
    expect(parsed.excludeStatusCode200).toBe(true);
  });

  test("statusCode '!200' maps to excludeStatusCode200", () => {
    const parsed = parseLogsUrlFilters({ statusCode: "!200" });
    expect(parsed.excludeStatusCode200).toBe(true);
    expect(parsed.statusCode).toBeUndefined();
  });

  test("parseIntParam returns undefined for invalid numbers", () => {
    const parsed = parseLogsUrlFilters({ userId: "NaN", startTime: "bad" });
    expect(parsed.userId).toBeUndefined();
    expect(parsed.startTime).toBeUndefined();
  });

  test("buildLogsUrlQuery omits empty sessionId", () => {
    const query = buildLogsUrlQuery({ sessionId: "   " });
    expect(query.get("sessionId")).toBeNull();
  });

  test("buildLogsUrlQuery includes sessionId and time range", () => {
    const query = buildLogsUrlQuery({ sessionId: "abc", startTime: 1, endTime: 2 });
    expect(query.get("sessionId")).toBe("abc");
    expect(query.get("startTime")).toBe("1");
    expect(query.get("endTime")).toBe("2");
  });

  test("buildLogsUrlQuery includes startTime/endTime even when 0", () => {
    const query = buildLogsUrlQuery({ startTime: 0, endTime: 0 });
    expect(query.get("startTime")).toBe("0");
    expect(query.get("endTime")).toBe("0");
  });

  test("parseLogsUrlFilters sanitizes invalid page (<1) to undefined", () => {
    expect(parseLogsUrlFilters({ page: "0" }).page).toBeUndefined();
    expect(parseLogsUrlFilters({ page: "-1" }).page).toBeUndefined();
    expect(parseLogsUrlFilters({ page: "1" }).page).toBe(1);
  });

  test("buildLogsUrlQuery only includes page when > 1", () => {
    expect(buildLogsUrlQuery({ page: 0 }).get("page")).toBeNull();
    expect(buildLogsUrlQuery({ page: 1 }).get("page")).toBeNull();
    expect(buildLogsUrlQuery({ page: 2 }).get("page")).toBe("2");
  });

  test("build + parse roundtrip preserves filters", () => {
    const original = {
      userId: 1,
      keyId: 2,
      providerId: 3,
      sessionId: "abc",
      startTime: 10,
      endTime: 20,
      statusCode: 500,
      excludeStatusCode200: false,
      model: "m",
      endpoint: "/v1/messages",
      minRetryCount: 2,
    };
    const query = buildLogsUrlQuery(original);

    const parsed = parseLogsUrlFilters(Object.fromEntries(query.entries()));
    expect(parsed).toEqual(expect.objectContaining(original));
  });

  test("buildLogsUrlQuery includes minRetryCount even when 0", () => {
    const query = buildLogsUrlQuery({ minRetryCount: 0 });
    expect(query.get("minRetry")).toBe("0");
  });
});
