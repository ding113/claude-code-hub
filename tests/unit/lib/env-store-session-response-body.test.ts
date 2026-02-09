import { afterEach, describe, expect, it } from "vitest";
import { EnvSchema } from "@/lib/config/env.schema";

describe("EnvSchema - STORE_SESSION_RESPONSE_BODY", () => {
  const originalEnv = process.env.STORE_SESSION_RESPONSE_BODY;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.STORE_SESSION_RESPONSE_BODY;
    } else {
      process.env.STORE_SESSION_RESPONSE_BODY = originalEnv;
    }
  });

  it("should default to true when not set", () => {
    delete process.env.STORE_SESSION_RESPONSE_BODY;
    const result = EnvSchema.parse(process.env);
    expect(result.STORE_SESSION_RESPONSE_BODY).toBe(true);
  });

  it("should parse 'true' as true", () => {
    process.env.STORE_SESSION_RESPONSE_BODY = "true";
    const result = EnvSchema.parse(process.env);
    expect(result.STORE_SESSION_RESPONSE_BODY).toBe(true);
  });

  it("should parse 'false' as false", () => {
    process.env.STORE_SESSION_RESPONSE_BODY = "false";
    const result = EnvSchema.parse(process.env);
    expect(result.STORE_SESSION_RESPONSE_BODY).toBe(false);
  });

  it("should parse '0' as false", () => {
    process.env.STORE_SESSION_RESPONSE_BODY = "0";
    const result = EnvSchema.parse(process.env);
    expect(result.STORE_SESSION_RESPONSE_BODY).toBe(false);
  });

  it("should parse '1' as true", () => {
    process.env.STORE_SESSION_RESPONSE_BODY = "1";
    const result = EnvSchema.parse(process.env);
    expect(result.STORE_SESSION_RESPONSE_BODY).toBe(true);
  });
});
