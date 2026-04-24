import { describe, expect, it } from "vitest";
import { buildLogsUrlQuery, parseLogsUrlFilters } from "./logs-query";

describe("logs-query", () => {
  it("builds query params for every logs filter field", () => {
    const query = buildLogsUrlQuery({
      userId: 2,
      keyId: 3,
      providerId: 4,
      sessionId: "session-abc",
      startTime: 1000,
      endTime: 2000,
      statusCode: 500,
      model: "claude-sonnet",
      endpoint: "/v1/messages",
      minRetryCount: 1,
      page: 3,
    });

    expect(query.toString()).toBe(
      "userId=2&keyId=3&providerId=4&sessionId=session-abc&startTime=1000&endTime=2000&statusCode=500&model=claude-sonnet&endpoint=%2Fv1%2Fmessages&minRetry=1&page=3"
    );
  });

  it("uses !200 when excluding successful status codes", () => {
    const query = buildLogsUrlQuery({
      statusCode: 500,
      excludeStatusCode200: true,
    });

    expect(query.toString()).toBe("statusCode=%21200");
  });

  it("parses logs url filters back from search params", () => {
    expect(
      parseLogsUrlFilters({
        userId: "2",
        keyId: "3",
        providerId: "4",
        sessionId: " session-abc ",
        startTime: "1000",
        endTime: "2000",
        statusCode: "!200",
        model: "claude-sonnet",
        endpoint: "/v1/messages",
        minRetry: "1",
        page: "3",
      })
    ).toEqual({
      userId: 2,
      keyId: 3,
      providerId: 4,
      sessionId: "session-abc",
      startTime: 1000,
      endTime: 2000,
      statusCode: undefined,
      excludeStatusCode200: true,
      model: "claude-sonnet",
      endpoint: "/v1/messages",
      minRetryCount: 1,
      page: 3,
    });
  });
});
