import { describe, expect, test } from "vitest";
import { buildLogsUrlQuery, parseLogsUrlFilters } from "@/app/[locale]/dashboard/logs/_utils/logs-query";

describe("dashboard logs url query utils", () => {
  test("parses and trims sessionId", () => {
    const parsed = parseLogsUrlFilters({ sessionId: "  abc  " });
    expect(parsed.sessionId).toBe("abc");
  });

  test("statusCode '!200' maps to excludeStatusCode200", () => {
    const parsed = parseLogsUrlFilters({ statusCode: "!200" });
    expect(parsed.excludeStatusCode200).toBe(true);
    expect(parsed.statusCode).toBeUndefined();
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
});

