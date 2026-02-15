import { describe, expect, it } from "vitest";
import { extractModelFromPath } from "@/app/v1/_lib/proxy/session";
import { detectFormatByEndpoint } from "@/app/v1/_lib/proxy/format-mapper";

describe("extractModelFromPath - Vertex AI publishers path", () => {
  it("extracts model from /v1/publishers/google/models/{model}:generateContent", () => {
    expect(
      extractModelFromPath(
        "/v1/publishers/google/models/gemini-3-pro-image-preview:generateContent"
      )
    ).toBe("gemini-3-pro-image-preview");
  });

  it("extracts model from /v1/publishers/google/models/{model}:streamGenerateContent", () => {
    expect(
      extractModelFromPath("/v1/publishers/google/models/gemini-2.5-flash:streamGenerateContent")
    ).toBe("gemini-2.5-flash");
  });

  it("extracts model from /v1/publishers/google/models/{model}:countTokens", () => {
    expect(extractModelFromPath("/v1/publishers/google/models/gemini-2.5-pro:countTokens")).toBe(
      "gemini-2.5-pro"
    );
  });

  it("extracts model from path without action suffix", () => {
    expect(extractModelFromPath("/v1/publishers/google/models/gemini-2.5-flash")).toBe(
      "gemini-2.5-flash"
    );
  });

  // regression: existing patterns still work
  it("still extracts model from /v1beta/models/{model}:generateContent", () => {
    expect(extractModelFromPath("/v1beta/models/gemini-2.5-flash:generateContent")).toBe(
      "gemini-2.5-flash"
    );
  });

  it("still extracts model from /v1/models/{model}:generateContent", () => {
    expect(extractModelFromPath("/v1/models/gemini-2.5-pro:generateContent")).toBe(
      "gemini-2.5-pro"
    );
  });

  it("returns null for unrecognized paths", () => {
    expect(extractModelFromPath("/v1/messages")).toBeNull();
    expect(extractModelFromPath("/v1/chat/completions")).toBeNull();
  });
});

describe("detectFormatByEndpoint - Vertex AI publishers path", () => {
  it('returns "gemini" for /v1/publishers/google/models/{model}:generateContent', () => {
    expect(
      detectFormatByEndpoint(
        "/v1/publishers/google/models/gemini-3-pro-image-preview:generateContent"
      )
    ).toBe("gemini");
  });

  it('returns "gemini" for /v1/publishers/google/models/{model}:streamGenerateContent', () => {
    expect(
      detectFormatByEndpoint("/v1/publishers/google/models/gemini-2.5-flash:streamGenerateContent")
    ).toBe("gemini");
  });

  it('returns "gemini" for /v1/publishers/google/models/{model}:countTokens', () => {
    expect(detectFormatByEndpoint("/v1/publishers/google/models/gemini-2.5-pro:countTokens")).toBe(
      "gemini"
    );
  });

  // regression: existing patterns still work
  it('still returns "gemini" for /v1beta/models/ path', () => {
    expect(detectFormatByEndpoint("/v1beta/models/gemini-2.5-flash:generateContent")).toBe(
      "gemini"
    );
  });

  it('still returns "gemini-cli" for /v1internal/models/ path', () => {
    expect(detectFormatByEndpoint("/v1internal/models/gemini-2.5-flash:generateContent")).toBe(
      "gemini-cli"
    );
  });

  it("returns null for unknown publishers path actions", () => {
    expect(
      detectFormatByEndpoint("/v1/publishers/google/models/gemini-2.5-flash:unknownAction")
    ).toBeNull();
  });
});
