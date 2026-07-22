import { describe, expect, it } from "vitest";
import {
  buildScopeTag,
  canonicalRequestBytes,
  sha256Hex,
  stableStringify,
} from "@/lib/request-identity";

describe("sha256Hex", () => {
  it("is deterministic and accepts string or bytes", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).toBe(sha256Hex(new TextEncoder().encode("abc")));
    expect(sha256Hex("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"));
  });
});

describe("stableStringify", () => {
  it("sorts object keys recursively", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(stableStringify({ arr: [{ b: 1, a: 2 }] })).toBe('{"arr":[{"a":2,"b":1}]}');
  });

  it("drops undefined object members and handles null", () => {
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}');
    expect(stableStringify(null)).toBe("null");
  });

  it("is insertion-order independent", () => {
    const first = JSON.parse('{"x":1,"y":{"p":true,"q":"s"}}');
    const second = JSON.parse('{"y":{"q":"s","p":true},"x":1}');
    expect(stableStringify(first)).toBe(stableStringify(second));
  });
});

describe("canonicalRequestBytes", () => {
  it("prefers the raw body buffer byte-for-byte", () => {
    const raw = new TextEncoder().encode('{"model":"m","messages":[]}');
    const buffer = raw.buffer.slice(0) as ArrayBuffer;
    const bytes = canonicalRequestBytes({ buffer, message: { different: true } });
    expect(new TextDecoder().decode(bytes)).toBe('{"model":"m","messages":[]}');
  });

  it("falls back to stable serialization of the parsed message", () => {
    const bytesA = canonicalRequestBytes({ message: { b: 1, a: 2 } });
    const bytesB = canonicalRequestBytes({ message: JSON.parse('{"a":2,"b":1}') });
    expect(new TextDecoder().decode(bytesA)).toBe(new TextDecoder().decode(bytesB));
  });
});

describe("buildScopeTag", () => {
  it("returns 16 hex chars and separates tenants / formats / models", () => {
    const tag = buildScopeTag(1, "claude", "sonnet");
    expect(tag).toMatch(/^[0-9a-f]{16}$/);
    expect(buildScopeTag(2, "claude", "sonnet")).not.toBe(tag);
    expect(buildScopeTag(1, "openai", "sonnet")).not.toBe(tag);
    expect(buildScopeTag(1, "claude", "opus")).not.toBe(tag);
    expect(buildScopeTag(1, "claude", "sonnet")).toBe(tag);
  });

  it("treats null and undefined model identically", () => {
    expect(buildScopeTag(1, "claude", null)).toBe(buildScopeTag(1, "claude", undefined));
  });
});
