import { afterEach, describe, expect, it } from "vitest";
import { EnvSchema } from "@/lib/config/env.schema";

describe("EnvSchema - STORE_SESSION_RESPONSE_BODY", () => {
  const originalEnv = process.env.STORE_SESSION_RESPONSE_BODY;
  const originalMaxBytes = process.env.SESSION_RESPONSE_BODY_MAX_BYTES;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.STORE_SESSION_RESPONSE_BODY;
    } else {
      process.env.STORE_SESSION_RESPONSE_BODY = originalEnv;
    }
    if (originalMaxBytes === undefined) {
      delete process.env.SESSION_RESPONSE_BODY_MAX_BYTES;
    } else {
      process.env.SESSION_RESPONSE_BODY_MAX_BYTES = originalMaxBytes;
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

  it("defaults the response body limit to 1 MiB", () => {
    delete process.env.SESSION_RESPONSE_BODY_MAX_BYTES;
    const result = EnvSchema.parse(process.env);
    expect(result.SESSION_RESPONSE_BODY_MAX_BYTES).toBe(1024 * 1024);
  });

  it("accepts the inclusive 64 KiB and 64 MiB response body limit boundaries", () => {
    process.env.SESSION_RESPONSE_BODY_MAX_BYTES = String(64 * 1024);
    expect(EnvSchema.parse(process.env).SESSION_RESPONSE_BODY_MAX_BYTES).toBe(64 * 1024);

    process.env.SESSION_RESPONSE_BODY_MAX_BYTES = String(64 * 1024 * 1024);
    expect(EnvSchema.parse(process.env).SESSION_RESPONSE_BODY_MAX_BYTES).toBe(64 * 1024 * 1024);
  });

  it("rejects response body limits outside the configured boundaries", () => {
    process.env.SESSION_RESPONSE_BODY_MAX_BYTES = String(64 * 1024 - 1);
    expect(() => EnvSchema.parse(process.env)).toThrow();

    process.env.SESSION_RESPONSE_BODY_MAX_BYTES = String(64 * 1024 * 1024 + 1);
    expect(() => EnvSchema.parse(process.env)).toThrow();
  });
});
