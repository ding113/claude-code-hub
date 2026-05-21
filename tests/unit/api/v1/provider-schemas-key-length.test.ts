import { describe, expect, test } from "vitest";

import { ProviderCreateSchema, ProviderUpdateSchema } from "@/lib/api/v1/schemas/providers";
import { PROVIDER_KEY_MAX_LENGTH } from "@/lib/constants/provider.constants";

describe("v1 Provider schemas - API 密钥长度限制", () => {
  const createBase = {
    name: "test-provider",
    url: "https://api.example.com",
  };

  test("ProviderCreateSchema 接受远超旧 1024 限制的密钥", () => {
    const longKey = "k".repeat(8192);
    expect(ProviderCreateSchema.safeParse({ ...createBase, key: longKey }).success).toBe(true);
  });

  test("ProviderCreateSchema 接受长度正好为上限的密钥", () => {
    const maxKey = "k".repeat(PROVIDER_KEY_MAX_LENGTH);
    expect(ProviderCreateSchema.safeParse({ ...createBase, key: maxKey }).success).toBe(true);
  });

  test("ProviderCreateSchema 拒绝超出上限的密钥", () => {
    const tooLongKey = "k".repeat(PROVIDER_KEY_MAX_LENGTH + 1);
    expect(ProviderCreateSchema.safeParse({ ...createBase, key: tooLongKey }).success).toBe(false);
  });

  test("ProviderCreateSchema 仍拒绝空密钥", () => {
    expect(ProviderCreateSchema.safeParse({ ...createBase, key: "" }).success).toBe(false);
  });

  test("ProviderUpdateSchema 接受远超旧 1024 限制的密钥", () => {
    const longKey = "k".repeat(65536);
    expect(ProviderUpdateSchema.safeParse({ key: longKey }).success).toBe(true);
  });

  test("ProviderUpdateSchema 接受长度正好为上限的密钥", () => {
    const maxKey = "k".repeat(PROVIDER_KEY_MAX_LENGTH);
    expect(ProviderUpdateSchema.safeParse({ key: maxKey }).success).toBe(true);
  });

  test("ProviderUpdateSchema 拒绝超出上限的密钥", () => {
    const tooLongKey = "k".repeat(PROVIDER_KEY_MAX_LENGTH + 1);
    expect(ProviderUpdateSchema.safeParse({ key: tooLongKey }).success).toBe(false);
  });

  test("ProviderUpdateSchema 仍拒绝空密钥", () => {
    expect(ProviderUpdateSchema.safeParse({ key: "" }).success).toBe(false);
  });
});
