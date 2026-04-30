import { describe, expect, test } from "vitest";
import { app } from "@/app/api/v1/_root/app";
import { buildOpenApiDocument } from "@/app/api/v1/_root/document";
import { HIDDEN_PROVIDER_TYPES } from "@/lib/api/v1/schemas/providers";
import { ProviderTypeSchema } from "@/lib/api/v1/schemas/_common";

describe("v1 provider type contract", () => {
  test("rejects hidden legacy provider types at schema level", () => {
    expect(ProviderTypeSchema.safeParse("claude").success).toBe(true);
    expect(ProviderTypeSchema.safeParse("codex").success).toBe(true);
    expect(ProviderTypeSchema.safeParse("gemini").success).toBe(true);
    expect(ProviderTypeSchema.safeParse("openai-compatible").success).toBe(true);

    for (const hiddenType of HIDDEN_PROVIDER_TYPES) {
      expect(ProviderTypeSchema.safeParse(hiddenType).success).toBe(false);
    }
  });

  test("does not expose hidden provider types in the OpenAPI document", () => {
    const serialized = JSON.stringify(buildOpenApiDocument(app));

    for (const hiddenType of HIDDEN_PROVIDER_TYPES) {
      expect(serialized).not.toContain(hiddenType);
    }
  });
});
