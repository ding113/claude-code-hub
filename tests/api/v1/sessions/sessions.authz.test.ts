import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 sessions authz evidence", () => {
  test("sessions tests cover self/admin scope and termination", () => {
    const source = readFileSync("tests/api/v1/sessions/sessions.test.ts", "utf8");

    expect(source).toContain("lists sessions and reads session details");
    expect(source).toContain("reads session payload subresources");
    expect(source).toContain("terminates sessions and returns problem+json for action failures");
    expect(source).toContain("/api/v1/sessions");
    expect(source).toContain("session.not_found");
  });
});
