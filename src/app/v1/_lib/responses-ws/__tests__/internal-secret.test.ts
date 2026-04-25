import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureInternalSecret,
  getInternalSecret,
  INTERNAL_SECRET_HEADER,
  RESERVED_INTERNAL_HEADERS,
  verifyInternalRequest,
  WS_FORWARD_FLAG_HEADER,
} from "../internal-secret";

const ENV_VAR = "CCH_RESPONSES_WS_INTERNAL_SECRET";

describe("internal-secret", () => {
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env[ENV_VAR];
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = originalSecret;
    }
  });

  it("returns null when the secret has not been initialized", () => {
    expect(getInternalSecret()).toBeNull();
  });

  it("ensureInternalSecret generates a UUID when none is preset", () => {
    const secret = ensureInternalSecret();
    expect(secret).toMatch(/^[0-9a-f-]{36}$/);
    expect(getInternalSecret()).toBe(secret);
  });

  it("ensureInternalSecret honors a pre-set value", () => {
    process.env[ENV_VAR] = "operator-supplied-secret";
    expect(ensureInternalSecret()).toBe("operator-supplied-secret");
  });

  it("ensureInternalSecret is idempotent", () => {
    const a = ensureInternalSecret();
    const b = ensureInternalSecret();
    expect(a).toBe(b);
  });

  it("verifyInternalRequest rejects when no secret is configured", () => {
    const h = new Headers();
    h.set(INTERNAL_SECRET_HEADER, "anything");
    h.set(WS_FORWARD_FLAG_HEADER, "1");
    expect(verifyInternalRequest(h)).toBe(false);
  });

  it("verifyInternalRequest rejects when the secret header is missing", () => {
    process.env[ENV_VAR] = "real-secret";
    const h = new Headers();
    h.set(WS_FORWARD_FLAG_HEADER, "1");
    expect(verifyInternalRequest(h)).toBe(false);
  });

  it("verifyInternalRequest rejects when the secret is wrong", () => {
    process.env[ENV_VAR] = "real-secret";
    const h = new Headers();
    h.set(INTERNAL_SECRET_HEADER, "spoofed-secret");
    h.set(WS_FORWARD_FLAG_HEADER, "1");
    expect(verifyInternalRequest(h)).toBe(false);
  });

  it("verifyInternalRequest rejects when the forward flag is missing", () => {
    process.env[ENV_VAR] = "real-secret";
    const h = new Headers();
    h.set(INTERNAL_SECRET_HEADER, "real-secret");
    expect(verifyInternalRequest(h)).toBe(false);
  });

  it("verifyInternalRequest accepts when secret + forward flag are correct", () => {
    process.env[ENV_VAR] = "real-secret";
    const h = new Headers();
    h.set(INTERNAL_SECRET_HEADER, "real-secret");
    h.set(WS_FORWARD_FLAG_HEADER, "1");
    expect(verifyInternalRequest(h)).toBe(true);
  });

  it("verifyInternalRequest works with plain Record<string,string> regardless of case", () => {
    process.env[ENV_VAR] = "real-secret";
    expect(
      verifyInternalRequest({
        "X-Cch-Internal-Secret": "real-secret",
        "X-Cch-Responses-Ws-Forward": "1",
      })
    ).toBe(true);
  });

  it("RESERVED_INTERNAL_HEADERS lists the secret + forward flag + transport markers", () => {
    expect(RESERVED_INTERNAL_HEADERS).toContain(INTERNAL_SECRET_HEADER);
    expect(RESERVED_INTERNAL_HEADERS).toContain(WS_FORWARD_FLAG_HEADER);
    expect(RESERVED_INTERNAL_HEADERS).toContain("x-cch-client-transport");
  });
});
