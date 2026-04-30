import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const docs = {
  readme: readFileSync("docs/api/v1/README.md", "utf8"),
  migration: readFileSync("docs/api/v1/migration-guide.md", "utf8"),
  apiKeyAdmin: readFileSync("docs/security/api-key-admin-access.md", "utf8"),
};

describe("v1 API documentation", () => {
  test("distinguishes management, proxy, and legacy API surfaces", () => {
    expect(docs.readme).toContain("/api/v1/*");
    expect(docs.readme).toContain("/v1/*");
    expect(docs.readme).toContain("/api/actions/*");
    expect(docs.readme).toContain("/api/v1/scalar");
    expect(docs.migration).toContain("Closes #1123");
  });

  test("documents API key admin access as opt-in and disabled by default", () => {
    expect(docs.apiKeyAdmin).toContain("ENABLE_API_KEY_ADMIN_ACCESS=false");
    expect(docs.apiKeyAdmin).toContain("ENABLE_API_KEY_ADMIN_ACCESS=true");
    expect(docs.apiKeyAdmin).toContain("role=admin");
  });
});
