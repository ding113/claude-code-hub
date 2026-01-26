import { describe, expect, test } from "vitest";
import { deriveDisplayNameFromDomain } from "@/repository/provider-endpoints";

describe("deriveDisplayNameFromDomain", () => {
  test("uses second-level label before suffix", () => {
    expect(deriveDisplayNameFromDomain("co.yes.vg")).toBe("Yes");
  });

  test("keeps api prefix handling and capitalization", () => {
    expect(deriveDisplayNameFromDomain("api.openai.com")).toBe("Openai");
  });

  test("falls back to first label when single part", () => {
    expect(deriveDisplayNameFromDomain("localhost")).toBe("Localhost");
  });
});
