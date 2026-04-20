import { describe, expect, test } from "vitest";
import { UpdateSystemSettingsSchema } from "@/lib/validation/schemas";

describe("UpdateSystemSettingsSchema ipExtractionConfig", () => {
  test("accepts valid pick variants", () => {
    const parsed = UpdateSystemSettingsSchema.parse({
      ipExtractionConfig: {
        headers: [
          { name: "x-real-ip" },
          { name: "x-forwarded-for", pick: "rightmost" },
          { name: "x-cluster-client-ip", pick: { kind: "index", index: 1 } },
        ],
      },
    });

    expect(parsed.ipExtractionConfig).toEqual({
      headers: [
        { name: "x-real-ip" },
        { name: "x-forwarded-for", pick: "rightmost" },
        { name: "x-cluster-client-ip", pick: { kind: "index", index: 1 } },
      ],
    });
  });

  test("rejects invalid pick payloads instead of accepting z.any()", () => {
    const result = UpdateSystemSettingsSchema.safeParse({
      ipExtractionConfig: {
        headers: [{ name: "x-forwarded-for", pick: { side: "middle" } }],
      },
    });

    expect(result.success).toBe(false);
  });
});
