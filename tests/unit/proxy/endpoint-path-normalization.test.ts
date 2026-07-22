import { describe, expect, test } from "vitest";
import { isRawPassthroughEndpointPath } from "@/app/v1/_lib/proxy/endpoint-policy";
import {
  isCountTokensEndpointPath,
  isResponseCompactEndpointPath,
} from "@/app/v1/_lib/proxy/endpoint-paths";
import { ProxySession } from "@/app/v1/_lib/proxy/session";

const countTokensVariants = [
  "/v1/messages/count_tokens",
  "/v1/messages/count_tokens/",
  "/V1/MESSAGES/COUNT_TOKENS",
];

const compactVariants = [
  "/v1/responses/compact",
  "/v1/responses/compact/",
  "/V1/RESPONSES/COMPACT",
];

function isCountTokensRequestWithEndpoint(pathname: string | null): boolean {
  const sessionLike = {
    getEndpoint: () => pathname,
  } as Pick<ProxySession, "getEndpoint">;

  return ProxySession.prototype.isCountTokensRequest.call(sessionLike as ProxySession);
}

describe("endpoint path normalization", () => {
  test.each(countTokensVariants)("count_tokens stays classified for variant %s", (pathname) => {
    expect(isCountTokensEndpointPath(pathname)).toBe(true);
    expect(isRawPassthroughEndpointPath(pathname)).toBe(true);
    expect(isCountTokensRequestWithEndpoint(pathname)).toBe(true);
  });

  test.each(compactVariants)("responses/compact stays classified for variant %s", (pathname) => {
    expect(isResponseCompactEndpointPath(pathname)).toBe(true);
    expect(isRawPassthroughEndpointPath(pathname)).toBe(true);
  });

  test.each([
    "/v1/messages",
    "/v1/responses",
    "/v1/messages/count",
    "/v1/responses/mini",
  ])("non-target path is not misclassified for %s", (pathname) => {
    expect(isCountTokensEndpointPath(pathname)).toBe(false);
    expect(isResponseCompactEndpointPath(pathname)).toBe(false);
    expect(isRawPassthroughEndpointPath(pathname)).toBe(false);
    expect(isCountTokensRequestWithEndpoint(pathname)).toBe(false);
  });

  test("session count_tokens detection handles null endpoint", () => {
    expect(isCountTokensRequestWithEndpoint(null)).toBe(false);
  });
});
