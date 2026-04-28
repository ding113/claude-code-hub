import { describe, expect, it } from "vitest";

import { generateTotp, verifyTotp, verifyTotpAndGetCounter } from "@/lib/security/totp";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP verification", () => {
  it("generates RFC 6238 SHA-1 vectors", () => {
    expect(generateTotp({ secret: RFC_SECRET, timestampMs: 59_000, digits: 8 })).toBe("94287082");
    expect(generateTotp({ secret: RFC_SECRET, timestampMs: 1_111_111_109_000, digits: 8 })).toBe(
      "07081804"
    );
    expect(generateTotp({ secret: RFC_SECRET, timestampMs: 1_111_111_111_000, digits: 8 })).toBe(
      "14050471"
    );
  });

  it("accepts current and adjacent time-step codes only", () => {
    const now = 1_700_000_000_000;
    const currentCode = generateTotp({ secret: RFC_SECRET, timestampMs: now });
    const previousCode = generateTotp({ secret: RFC_SECRET, timestampMs: now - 30_000 });
    const staleCode = generateTotp({ secret: RFC_SECRET, timestampMs: now - 90_000 });

    expect(verifyTotp({ secret: RFC_SECRET, code: currentCode, timestampMs: now })).toBe(true);
    expect(verifyTotp({ secret: RFC_SECRET, code: previousCode, timestampMs: now })).toBe(true);
    expect(verifyTotp({ secret: RFC_SECRET, code: staleCode, timestampMs: now })).toBe(false);
  });

  it("returns the matched time-step counter for replay protection", () => {
    const now = 1_700_000_000_000;
    const currentCode = generateTotp({ secret: RFC_SECRET, timestampMs: now });
    const previousCode = generateTotp({ secret: RFC_SECRET, timestampMs: now - 30_000 });

    expect(
      verifyTotpAndGetCounter({ secret: RFC_SECRET, code: currentCode, timestampMs: now })
    ).toEqual({ counter: Math.floor(now / 1000 / 30) });
    expect(
      verifyTotpAndGetCounter({ secret: RFC_SECRET, code: previousCode, timestampMs: now })
    ).toEqual({ counter: Math.floor((now - 30_000) / 1000 / 30) });
  });

  it("rejects malformed codes and secrets", () => {
    expect(verifyTotp({ secret: RFC_SECRET, code: "12345x", timestampMs: 59_000 })).toBe(false);
    expect(verifyTotp({ secret: RFC_SECRET, code: "94287082", timestampMs: 59_000 })).toBe(false);
    expect(verifyTotp({ secret: "not base32!", code: "123456", timestampMs: 59_000 })).toBe(false);
    expect(
      verifyTotpAndGetCounter({ secret: RFC_SECRET, code: "94287082", timestampMs: 59_000 })
    ).toBeNull();
  });
});
