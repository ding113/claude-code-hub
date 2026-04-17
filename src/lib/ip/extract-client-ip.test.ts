import { describe, expect, test } from "vitest";
import { DEFAULT_IP_EXTRACTION_CONFIG } from "@/types/ip-extraction";
import { extractClientIp } from "./extract-client-ip";

function h(entries: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(entries)) headers.set(k, v);
  return headers;
}

describe("extractClientIp — default config", () => {
  test("does NOT trust cf-connecting-ip out of the box (spoofable without an edge in front)", () => {
    const headers = h({
      "cf-connecting-ip": "1.1.1.1",
      "x-real-ip": "2.2.2.2",
      "x-forwarded-for": "3.3.3.3, 4.4.4.4",
    });
    expect(extractClientIp(headers, DEFAULT_IP_EXTRACTION_CONFIG)).toBe("2.2.2.2");
  });

  test("prefers x-real-ip over x-forwarded-for", () => {
    const headers = h({
      "x-real-ip": "2.2.2.2",
      "x-forwarded-for": "3.3.3.3, 4.4.4.4",
    });
    expect(extractClientIp(headers, DEFAULT_IP_EXTRACTION_CONFIG)).toBe("2.2.2.2");
  });

  test("falls back to x-forwarded-for rightmost entry", () => {
    const headers = h({ "x-forwarded-for": "3.3.3.3, 4.4.4.4" });
    expect(extractClientIp(headers, DEFAULT_IP_EXTRACTION_CONFIG)).toBe("4.4.4.4");
  });

  test("returns null when no configured header matches", () => {
    expect(extractClientIp(h({}), DEFAULT_IP_EXTRACTION_CONFIG)).toBeNull();
  });
});

describe("extractClientIp — XFF pick variants", () => {
  test("leftmost picks the first entry", () => {
    const headers = h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" });
    expect(
      extractClientIp(headers, {
        headers: [{ name: "x-forwarded-for", pick: "leftmost" }],
      })
    ).toBe("1.1.1.1");
  });

  test("rightmost picks the last entry", () => {
    const headers = h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" });
    expect(
      extractClientIp(headers, {
        headers: [{ name: "x-forwarded-for", pick: "rightmost" }],
      })
    ).toBe("3.3.3.3");
  });

  test("explicit 0-based index picks the Nth entry from left", () => {
    const headers = h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" });
    expect(
      extractClientIp(headers, {
        headers: [{ name: "x-forwarded-for", pick: { kind: "index", index: 1 } }],
      })
    ).toBe("2.2.2.2");
  });

  test("index out of bounds skips the rule and continues fallback chain", () => {
    const headers = h({
      "x-forwarded-for": "1.1.1.1",
      "x-real-ip": "9.9.9.9",
    });
    expect(
      extractClientIp(headers, {
        headers: [
          { name: "x-forwarded-for", pick: { kind: "index", index: 5 } },
          { name: "x-real-ip" },
        ],
      })
    ).toBe("9.9.9.9");
  });

  test("negative index is treated as invalid and skips rule", () => {
    const headers = h({
      "x-forwarded-for": "1.1.1.1",
      "x-real-ip": "9.9.9.9",
    });
    expect(
      extractClientIp(headers, {
        headers: [
          { name: "x-forwarded-for", pick: { kind: "index", index: -1 } },
          { name: "x-real-ip" },
        ],
      })
    ).toBe("9.9.9.9");
  });
});

describe("extractClientIp — parsing robustness", () => {
  test("trims whitespace from XFF values", () => {
    const headers = h({ "x-forwarded-for": "  1.1.1.1  ,   2.2.2.2  " });
    expect(
      extractClientIp(headers, {
        headers: [{ name: "x-forwarded-for", pick: "leftmost" }],
      })
    ).toBe("1.1.1.1");
  });

  test("drops empty XFF entries (from trailing commas)", () => {
    const headers = h({ "x-forwarded-for": "1.1.1.1, ," });
    expect(
      extractClientIp(headers, {
        headers: [{ name: "x-forwarded-for", pick: "rightmost" }],
      })
    ).toBe("1.1.1.1");
  });

  test("header lookup is case-insensitive (Headers normalizes)", () => {
    const headers = new Headers();
    headers.set("X-Real-IP", "5.5.5.5");
    expect(extractClientIp(headers, { headers: [{ name: "x-real-ip" }] })).toBe("5.5.5.5");
  });

  test("strips port suffix from IPv4 value", () => {
    const headers = h({ "x-real-ip": "1.2.3.4:5678" });
    expect(extractClientIp(headers, { headers: [{ name: "x-real-ip" }] })).toBe("1.2.3.4");
  });

  test("strips bracketed IPv6 form with port", () => {
    const headers = h({ "x-real-ip": "[2001:db8::1]:443" });
    expect(extractClientIp(headers, { headers: [{ name: "x-real-ip" }] })).toBe("2001:db8::1");
  });

  test("accepts plain IPv6 without brackets", () => {
    const headers = h({ "x-real-ip": "2001:db8::1" });
    expect(extractClientIp(headers, { headers: [{ name: "x-real-ip" }] })).toBe("2001:db8::1");
  });

  test("skips rule with invalid IP and continues fallback chain", () => {
    const headers = h({ "x-real-ip": "not-an-ip", "cf-connecting-ip": "1.1.1.1" });
    expect(
      extractClientIp(headers, {
        headers: [{ name: "x-real-ip" }, { name: "cf-connecting-ip" }],
      })
    ).toBe("1.1.1.1");
  });

  test("empty header value is skipped", () => {
    const headers = h({ "x-real-ip": "   ", "cf-connecting-ip": "1.1.1.1" });
    expect(
      extractClientIp(headers, {
        headers: [{ name: "x-real-ip" }, { name: "cf-connecting-ip" }],
      })
    ).toBe("1.1.1.1");
  });
});

describe("extractClientIp — misc", () => {
  test("accepts plain object headers (Record<string,string>)", () => {
    expect(extractClientIp({ "x-real-ip": "7.7.7.7" }, { headers: [{ name: "x-real-ip" }] })).toBe(
      "7.7.7.7"
    );
  });

  test("no headers configured returns null", () => {
    expect(extractClientIp(h({ "x-real-ip": "1.1.1.1" }), { headers: [] })).toBeNull();
  });

  test("uses DEFAULT_IP_EXTRACTION_CONFIG when config omitted", () => {
    const headers = h({ "x-real-ip": "5.5.5.5" });
    expect(extractClientIp(headers)).toBe("5.5.5.5");
  });
});
