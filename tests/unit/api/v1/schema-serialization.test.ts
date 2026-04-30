import { describe, expect, test } from "vitest";
import { ProblemJsonSchema, ProviderTypeSchema } from "@/lib/api/v1/schemas/_common";
import { serializeDates, toIsoDateTime } from "@/lib/api/v1/_shared/serialization";

describe("v1 schema serialization", () => {
  test("serializes Date values to ISO strings", () => {
    const date = new Date("2026-04-28T00:00:00.000Z");

    expect(toIsoDateTime(date)).toBe("2026-04-28T00:00:00.000Z");
    expect(serializeDates({ createdAt: date, nested: [date] })).toEqual({
      createdAt: "2026-04-28T00:00:00.000Z",
      nested: ["2026-04-28T00:00:00.000Z"],
    });
  });

  test("does not include hidden provider types in the public enum", () => {
    expect(ProviderTypeSchema.safeParse("claude").success).toBe(true);
    expect(ProviderTypeSchema.safeParse("openai-compatible").success).toBe(true);
    expect(ProviderTypeSchema.safeParse("claude-auth").success).toBe(false);
    expect(ProviderTypeSchema.safeParse("gemini-cli").success).toBe(false);
  });

  test("accepts URN problem type identifiers", () => {
    expect(
      ProblemJsonSchema.safeParse({
        type: "urn:claude-code-hub:problem:auth.forbidden",
        title: "Forbidden",
        status: 403,
        detail: "Admin access is required.",
        instance: "/api/v1/providers",
        errorCode: "auth.forbidden",
      }).success
    ).toBe(true);
  });
});
