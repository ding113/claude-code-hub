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

  test("redacts webhookSecret regardless of case / separator", () => {
    const out = redactSensitive({
      webhookSecret: "a",
      webhook_secret: "b",
      WebhookSecret: "c",
      "webhook-secret": "d",
    });
    expect(out).toEqual({
      webhookSecret: "[REDACTED]",
      webhook_secret: "[REDACTED]",
      WebhookSecret: "[REDACTED]",
      "webhook-secret": "[REDACTED]",
    });
  });

  test("non-POJO objects (Date) pass through intact — not rewritten to {}", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const out = redactSensitive({ createdAt: now }) as { createdAt: Date };
    expect(out.createdAt).toBe(now);
    expect(out.createdAt.getTime()).toBe(now.getTime());
  });

  test("class instances pass through intact", () => {
    class Money {
      constructor(public amount: number) {}
    }
    const m = new Money(42);
    const out = redactSensitive({ cost: m }) as { cost: Money };
    expect(out.cost).toBe(m);
    expect(out.cost.amount).toBe(42);
  });

  test("Object.create(null) is treated as POJO and still walked", () => {
    const bare = Object.create(null);
    bare.apiKey = "sk-x";
    bare.name = "ok";
    const out = redactSensitive(bare);
    expect(out).toEqual({ apiKey: "[REDACTED]", name: "ok" });
  });
});
