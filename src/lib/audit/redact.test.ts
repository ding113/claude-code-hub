import { describe, expect, test } from "vitest";
import { redactSensitive } from "./redact";

describe("redactSensitive", () => {
  test("masks default sensitive keys case-insensitively", () => {
    const out = redactSensitive({
      name: "foo",
      apiKey: "sk-xyz",
      API_KEY: "sk-xyz",
      token: "t1",
      Password: "hunter2",
    });
    expect(out).toEqual({
      name: "foo",
      apiKey: "[REDACTED]",
      API_KEY: "[REDACTED]",
      token: "[REDACTED]",
      Password: "[REDACTED]",
    });
  });

  test("walks nested objects and arrays", () => {
    const out = redactSensitive({
      providers: [
        { id: 1, apiKey: "a" },
        { id: 2, apiKey: "b" },
      ],
      meta: { secret: "hidden", keep: 42 },
    });
    expect(out).toEqual({
      providers: [
        { id: 1, apiKey: "[REDACTED]" },
        { id: 2, apiKey: "[REDACTED]" },
      ],
      meta: { secret: "[REDACTED]", keep: 42 },
    });
  });

  test("extraKeys are included (case-insensitive)", () => {
    const out = redactSensitive({ name: "foo", customField: "sensitive" }, ["customField"]);
    expect(out).toEqual({ name: "foo", customField: "[REDACTED]" });
  });

  test("passes through primitives unchanged", () => {
    expect(redactSensitive("hello")).toBe("hello");
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
  });

  test("never mutates the input", () => {
    const input = { key: "x", name: "y" };
    const result = redactSensitive(input);
    expect(input.key).toBe("x");
    expect(result).not.toBe(input);
  });
});
