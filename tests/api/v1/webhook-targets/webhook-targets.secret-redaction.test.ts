import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 webhook target secret redaction evidence", () => {
  test("CRUD tests assert secret redaction and placeholder rejection", () => {
    const source = readFileSync(
      "tests/api/v1/webhook-targets/webhook-targets.crud.test.ts",
      "utf8"
    );

    expect(source).toContain("lists targets and redacts write-only secrets");
    expect(source).toContain('not.toContain("webhook-secret")');
    expect(source).toContain('not.toContain("token:secret")');
    expect(source).toContain("webhook_target.redacted_placeholder_rejected");
  });
});
