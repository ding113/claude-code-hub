import { describe, expect, test } from "vitest";
import { shouldRecordProviderCircuitFailure } from "@/app/v1/_lib/proxy/circuit-breaker-accounting";

describe("shouldRecordProviderCircuitFailure", () => {
  test.each([
    401, 402, 403, 408, 429, 451, 500, 502, 503, 504,
  ])("counts upstream failure status %s", (statusCode) => {
    expect(shouldRecordProviderCircuitFailure(statusCode)).toBe(true);
  });

  test.each([
    400, 404, 409, 413, 415, 422,
  ])("does not count client-driven status %s", (statusCode) => {
    expect(shouldRecordProviderCircuitFailure(statusCode)).toBe(false);
  });
});
