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
});
