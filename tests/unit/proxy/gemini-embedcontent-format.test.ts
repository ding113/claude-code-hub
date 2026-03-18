import { describe, expect, it } from "vitest";
import { detectFormatByEndpoint } from "@/app/v1/_lib/proxy/format-mapper";

describe("detectFormatByEndpoint - Gemini embedContent", () => {
  it.each([
    "/v1beta/models/gemini-2.5-flash:embedContent",
    "/v1/publishers/google/models/gemini-2.5-pro:embedContent",
  ])('returns "gemini" for %s', (pathname) => {
    expect(detectFormatByEndpoint(pathname)).toBe("gemini");
  });

  it.each([
    "/v1beta/models/gemini-2.5-flash:unknownAction",
    "/v1/publishers/google/models/gemini-2.5-pro:unknownAction",
  ])("returns null for unknown Gemini actions: %s", (pathname) => {
    expect(detectFormatByEndpoint(pathname)).toBeNull();
  });

  it("does not classify internal embedContent as gemini-cli", () => {
    expect(detectFormatByEndpoint("/v1internal/models/gemini-2.5-flash:embedContent")).toBeNull();
  });
});
