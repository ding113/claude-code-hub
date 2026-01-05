import { describe, expect, it } from "vitest";
import { UpdateSystemSettingsSchema } from "@/lib/validation/schemas";

describe("UpdateSystemSettingsSchema - thinking signature 修复开关", () => {
  it("应允许 enableThinkingSignatureFix 字段（可选布尔）", () => {
    const result = UpdateSystemSettingsSchema.safeParse({
      enableThinkingSignatureFix: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // 若 schema 未声明该字段，zod 会静默剥离未知字段，此处用于防止“误通过”
      expect(result.data).toHaveProperty("enableThinkingSignatureFix", true);
    }
  });
});
