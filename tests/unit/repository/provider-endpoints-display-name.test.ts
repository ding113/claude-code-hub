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

  test("handles common API prefixes correctly", async () => {
    expect(await deriveDisplayNameFromDomain("v1.api.anthropic.com")).toBe("Anthropic");
    expect(await deriveDisplayNameFromDomain("www.example.com")).toBe("Example");
    expect(await deriveDisplayNameFromDomain("api.anthropic.com")).toBe("Anthropic");
  });

  test("handles standard domains without prefixes", async () => {
    expect(await deriveDisplayNameFromDomain("anthropic.com")).toBe("Anthropic");
    expect(await deriveDisplayNameFromDomain("openai.com")).toBe("Openai");
  });
});
