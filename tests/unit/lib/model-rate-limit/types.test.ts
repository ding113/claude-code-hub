import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isModelRateLimitEnabled, isModelRateLimitFailOpen } from "@/lib/model-rate-limit/types";

const ENV_KEYS = ["ENABLE_MODEL_RATE_LIMIT", "ENABLE_RATE_LIMIT", "MODEL_RATE_LIMIT_FAIL_OPEN"];

describe("isModelRateLimitEnabled", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to disabled when ENABLE_MODEL_RATE_LIMIT is unset", () => {
    delete process.env.ENABLE_MODEL_RATE_LIMIT;
    delete process.env.ENABLE_RATE_LIMIT;
    expect(isModelRateLimitEnabled()).toBe(false);
  });

  it("is enabled when ENABLE_MODEL_RATE_LIMIT=true and rate limiting is on", () => {
    process.env.ENABLE_MODEL_RATE_LIMIT = "true";
    delete process.env.ENABLE_RATE_LIMIT; // mainline default is enabled
    expect(isModelRateLimitEnabled()).toBe(true);
  });

  it("stays disabled when ENABLE_MODEL_RATE_LIMIT=false", () => {
    process.env.ENABLE_MODEL_RATE_LIMIT = "false";
    delete process.env.ENABLE_RATE_LIMIT;
    expect(isModelRateLimitEnabled()).toBe(false);
  });

  it("is disabled when mainline ENABLE_RATE_LIMIT is off, even if model flag is on", () => {
    process.env.ENABLE_MODEL_RATE_LIMIT = "true";
    process.env.ENABLE_RATE_LIMIT = "false";
    expect(isModelRateLimitEnabled()).toBe(false);
  });
});

describe("isModelRateLimitFailOpen", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.MODEL_RATE_LIMIT_FAIL_OPEN;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.MODEL_RATE_LIMIT_FAIL_OPEN;
    else process.env.MODEL_RATE_LIMIT_FAIL_OPEN = saved;
  });

  it("defaults to fail-open when unset", () => {
    delete process.env.MODEL_RATE_LIMIT_FAIL_OPEN;
    expect(isModelRateLimitFailOpen()).toBe(true);
  });

  it("can be disabled explicitly", () => {
    process.env.MODEL_RATE_LIMIT_FAIL_OPEN = "false";
    expect(isModelRateLimitFailOpen()).toBe(false);
  });
});
