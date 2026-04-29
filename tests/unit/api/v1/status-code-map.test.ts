import { describe, expect, test } from "vitest";
import {
  getDefaultErrorCode,
  getDefaultProblemTitle,
  type ProblemStatusCode,
} from "@/lib/api/v1/_shared/status-code-map";

describe("v1 status code map", () => {
  test.each([
    [400, "Bad request", "request.invalid"],
    [401, "Unauthorized", "auth.invalid"],
    [403, "Forbidden", "auth.forbidden"],
    [404, "Not found", "resource.not_found"],
    [409, "Conflict", "resource.conflict"],
    [415, "Unsupported media type", "request.unsupported_media_type"],
    [429, "Too many requests", "rate_limit.exceeded"],
    [503, "Service unavailable", "dependency.unavailable"],
  ] as Array<
    [ProblemStatusCode, string, string]
  >)("maps %s to defaults", (status, title, errorCode) => {
    expect(getDefaultProblemTitle(status)).toBe(title);
    expect(getDefaultErrorCode(status)).toBe(errorCode);
  });
});
