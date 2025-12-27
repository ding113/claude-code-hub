import { describe, expect, test } from "vitest";
import { isSessionMessages } from "./session-messages-guards";

describe("isSessionMessages type guard", () => {
  test("accepts valid single non-empty record object", () => {
    expect(isSessionMessages({ role: "user", content: "hi" })).toBe(true);
  });

  test("accepts valid non-empty array of non-empty record objects", () => {
    expect(isSessionMessages([{ role: "user" }, { role: "assistant" }])).toBe(true);
  });

  test("rejects empty array", () => {
    expect(isSessionMessages([])).toBe(false);
  });

  test("rejects empty object", () => {
    expect(isSessionMessages({})).toBe(false);
  });

  test("rejects array containing empty object", () => {
    expect(isSessionMessages([{ role: "user" }, {}])).toBe(false);
  });

  test("rejects array with non-record items", () => {
    expect(isSessionMessages(["string", 123, null])).toBe(false);
  });

  test("rejects primitives", () => {
    expect(isSessionMessages(null)).toBe(false);
    expect(isSessionMessages("string")).toBe(false);
    expect(isSessionMessages(123)).toBe(false);
  });

  test("rejects special objects like Date/RegExp", () => {
    expect(isSessionMessages(new Date())).toBe(false);
    expect(isSessionMessages(/re/)).toBe(false);
  });
});
