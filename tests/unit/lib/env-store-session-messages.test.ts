import { describe, expect, it, afterEach } from "vitest";
import { EnvSchema } from "@/lib/config/env.schema";

describe("EnvSchema - STORE_SESSION_MESSAGES", () => {
  // Store original env
  const originalEnv = process.env.STORE_SESSION_MESSAGES;

  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.STORE_SESSION_MESSAGES;
    } else {
      process.env.STORE_SESSION_MESSAGES = originalEnv;
    }
  });

  it("should default to false when not set", () => {
    delete process.env.STORE_SESSION_MESSAGES;
    const result = EnvSchema.parse(process.env);
    expect(result.STORE_SESSION_MESSAGES).toBe(false);
  });

  it("should parse 'true' as true", () => {
    process.env.STORE_SESSION_MESSAGES = "true";
    const result = EnvSchema.parse(process.env);
    expect(result.STORE_SESSION_MESSAGES).toBe(true);
  });

  it("should parse 'false' as false", () => {
    process.env.STORE_SESSION_MESSAGES = "false";
    const result = EnvSchema.parse(process.env);
    expect(result.STORE_SESSION_MESSAGES).toBe(false);
  });

  it("should parse '0' as false", () => {
    process.env.STORE_SESSION_MESSAGES = "0";
    const result = EnvSchema.parse(process.env);
    expect(result.STORE_SESSION_MESSAGES).toBe(false);
  });

  it("should parse '1' as true", () => {
    process.env.STORE_SESSION_MESSAGES = "1";
    const result = EnvSchema.parse(process.env);
    expect(result.STORE_SESSION_MESSAGES).toBe(true);
  });
});
