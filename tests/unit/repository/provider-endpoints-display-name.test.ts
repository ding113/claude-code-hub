import { describe, expect, test } from "vitest";
import { deriveDisplayNameFromDomain } from "@/repository/provider-endpoints";

describe("deriveDisplayNameFromDomain", () => {
  test("uses second-level label before suffix", async () => {
    expect(await deriveDisplayNameFromDomain("co.yes.vg")).toBe("Yes");
  });

  test("keeps api prefix handling and capitalization", async () => {
    expect(await deriveDisplayNameFromDomain("api.openai.com")).toBe("Openai");
  });

  test("falls back to first label when single part", async () => {
    expect(await deriveDisplayNameFromDomain("localhost")).toBe("Localhost");
  });
});
