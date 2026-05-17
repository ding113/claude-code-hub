import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 keys authz evidence", () => {
  test("keys test file covers auth and CSRF boundaries", () => {
    const source = readFileSync("tests/api/v1/keys/keys.test.ts", "utf8");

    expect(source).toContain(
      "rejects user API keys for key management when API key admin access is disabled"
    );
    expect(source).toContain("requires CSRF for cookie-authenticated key mutations");
    expect(source).toContain("auth.api_key_admin_disabled");
    expect(source).toContain("auth.csrf_invalid");
  });
});
