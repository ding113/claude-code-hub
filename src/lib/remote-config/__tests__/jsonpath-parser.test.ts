import { describe, expect, test } from "vitest";
import { extractBalance } from "../jsonpath-parser";

describe("remote-config/jsonpath-parser", () => {
  test("extracts numeric value", () => {
    const data = { remaining_credits: 12.34 };
    expect(extractBalance(data, "$.remaining_credits")).toBeCloseTo(12.34);
  });

  test("extracts numeric string value", () => {
    const data = { remaining_credits: "12.34" };
    expect(extractBalance(data, "$.remaining_credits")).toBeCloseTo(12.34);
  });

  test("throws when no match", () => {
    expect(() => extractBalance({ remaining_credits: 1 }, "$.missing")).toThrow(/no match/i);
  });

  test("throws when multiple matches", () => {
    const data = { items: [{ v: 1 }, { v: 2 }] };
    expect(() => extractBalance(data, "$.items[*].v")).toThrow(/multiple/i);
  });

  test("rejects expressions requiring evaluation", () => {
    const data = { items: [{ v: 1 }, { v: 2 }] };
    expect(() => extractBalance(data, "$.items[?(@.v>1)].v")).toThrow();
  });
});
