import { describe, expect, test } from "vitest";
import { CreateProviderSchema, UpdateProviderSchema } from "@/lib/validation/schemas";

describe("Provider timeout schemas", () => {
  test("CreateProviderSchema accepts 1 second streaming first-byte timeout and 0 as disabled", () => {
    const disabled = CreateProviderSchema.parse({
      name: "test-provider",
      url: "https://example.com",
      key: "sk-test",
      first_byte_timeout_streaming_ms: 0,
    });

    const enabled = CreateProviderSchema.parse({
      name: "test-provider",
      url: "https://example.com",
      key: "sk-test",
      first_byte_timeout_streaming_ms: 1000,
      streaming_idle_timeout_ms: 60000,
      request_timeout_non_streaming_ms: 60000,
    });

    expect(disabled.first_byte_timeout_streaming_ms).toBe(0);
    expect(enabled.first_byte_timeout_streaming_ms).toBe(1000);
  });

  test("UpdateProviderSchema rejects streaming first-byte timeout below 1 second", () => {
    expect(() =>
      UpdateProviderSchema.parse({
        first_byte_timeout_streaming_ms: 999,
      })
    ).toThrow("流式首字节超时不能少于1秒");
  });

  test("UpdateProviderSchema accepts 1800 second non-streaming timeout upper bound", () => {
    const parsed = UpdateProviderSchema.parse({
      request_timeout_non_streaming_ms: 1_800_000,
    });

    expect(parsed.request_timeout_non_streaming_ms).toBe(1_800_000);
  });
});
