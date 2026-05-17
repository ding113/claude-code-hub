import { z as openApiZ } from "@hono/zod-openapi";
import { describe, expect, test } from "vitest";
import {
  CreateProviderSchema,
  CreateUserSchema,
  UpdateProviderSchema,
  UpdateUserSchema,
} from "@/lib/validation/schemas";

describe("validation schemas after OpenAPI zod registration", () => {
  test("keeps optional user fields optional", () => {
    expect(typeof openApiZ.string().openapi).toBe("function");

    const created = CreateUserSchema.parse({ name: "test-user" });
    const updated = UpdateUserSchema.parse({});

    expect(created.allowedClients).toEqual([]);
    expect(created.blockedClients).toEqual([]);
    expect(created.expiresAt).toBeUndefined();
    expect(updated.allowedClients).toBeUndefined();
    expect(updated.blockedClients).toBeUndefined();
    expect(updated.expiresAt).toBeUndefined();
  });

  test("keeps optional provider fields optional", () => {
    expect(typeof openApiZ.string().openapi).toBe("function");

    const created = CreateProviderSchema.parse({
      name: "test-provider",
      url: "https://example.com",
      key: "sk-test",
    });
    const updated = UpdateProviderSchema.parse({
      request_timeout_non_streaming_ms: 1_800_000,
    });

    expect(created.allowed_clients).toEqual([]);
    expect(created.blocked_clients).toEqual([]);
    expect(updated.allowed_clients).toBeUndefined();
    expect(updated.blocked_clients).toBeUndefined();
    expect(updated.request_timeout_non_streaming_ms).toBe(1_800_000);
  });
});
