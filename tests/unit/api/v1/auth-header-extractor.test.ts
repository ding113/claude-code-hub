import { describe, expect, test } from "vitest";
import {
  extractApiCredentialFromHeaders,
  extractApiKeyFromHeaders,
} from "@/lib/api/auth-header-extractor";

describe("management API credential header extraction", () => {
  test("prefers bearer credentials before api-key headers", () => {
    expect(
      extractApiCredentialFromHeaders({
        authorization: "Bearer bearer-token",
        "x-api-key": "x-key",
        "x-goog-api-key": "goog-key",
      })
    ).toEqual({ token: "bearer-token", source: "bearer" });
  });

  test("extracts x-api-key and x-goog-api-key fallback values", () => {
    expect(extractApiCredentialFromHeaders({ "x-api-key": " x-key " })).toEqual({
      token: "x-key",
      source: "api-key",
    });
    expect(extractApiCredentialFromHeaders({ "x-goog-api-key": " goog-key " })).toEqual({
      token: "goog-key",
      source: "goog-api-key",
    });
    expect(extractApiKeyFromHeaders({ "x-goog-api-key": " goog-key " })).toBe("goog-key");
  });

  test("ignores malformed or empty credentials", () => {
    expect(extractApiCredentialFromHeaders({ authorization: "Basic value" })).toEqual({
      token: null,
      source: "none",
    });
    expect(extractApiKeyFromHeaders({ "x-api-key": " " })).toBeNull();
  });
});
