import { describe, expect, test } from "vitest";
import { redactHeaders, redactSecret } from "@/lib/api/v1/_shared/redaction";

describe("v1 secret redaction", () => {
  test("redacts secret values and sensitive headers", () => {
    expect(redactSecret("sk-1234567890")).toBe("sk-1...[REDACTED]...7890");
    expect(redactSecret("short")).toBe("[REDACTED]");

    const headers = new Headers({
      Authorization: "Bearer secret",
      "X-Api-Key": "sk-secret",
      "Content-Type": "application/json",
    });

    expect(redactHeaders(headers)).toEqual({
      authorization: "[REDACTED]",
      "content-type": "application/json",
      "x-api-key": "[REDACTED]",
    });
  });

  test("redacts provider key and proxy credentials", () => {
    expect(redactSecret("sk-provider-1234567890")).toBe("sk-p...[REDACTED]...7890");

    const providerHeaders = new Headers({
      Authorization: "Bearer provider-secret",
      "CF-AIG-Authorization": "Bearer upstream-secret",
      "X-Trace": "safe-trace",
    });

    expect(redactHeaders(providerHeaders)).toEqual({
      authorization: "[REDACTED]",
      "cf-aig-authorization": "[REDACTED]",
      "x-trace": "safe-trace",
    });
  });
});
