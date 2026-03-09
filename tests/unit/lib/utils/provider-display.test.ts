import { describe, expect, it } from "vitest";
import { isProviderFinalized } from "@/lib/utils/provider-display";

describe("isProviderFinalized", () => {
  it.each([
    {
      name: "null providerChain + null statusCode = not finalized",
      entry: { providerChain: null, statusCode: null, blockedBy: null },
      expected: false,
    },
    {
      name: "empty providerChain + null statusCode = not finalized",
      entry: { providerChain: [], statusCode: null, blockedBy: null },
      expected: false,
    },
    {
      name: "undefined fields = not finalized",
      entry: {},
      expected: false,
    },
    {
      name: "providerChain with items = finalized",
      entry: { providerChain: [{ id: 1, name: "provider-a" }], statusCode: 200 },
      expected: true,
    },
    {
      name: "null providerChain + statusCode present = finalized",
      entry: { providerChain: null, statusCode: 200 },
      expected: true,
    },
    {
      name: "statusCode 0 counts as finalized",
      entry: { providerChain: null, statusCode: 0 },
      expected: true,
    },
    {
      name: "error statusCode = finalized",
      entry: { providerChain: null, statusCode: 500 },
      expected: true,
    },
    {
      name: "blockedBy = finalized (regardless of other fields)",
      entry: { providerChain: null, statusCode: null, blockedBy: "sensitive_word" },
      expected: true,
    },
    {
      name: "blockedBy takes priority over missing chain/status",
      entry: { blockedBy: "rate_limit" },
      expected: true,
    },
  ])("$name", ({ entry, expected }) => {
    expect(isProviderFinalized(entry)).toBe(expected);
  });
});
