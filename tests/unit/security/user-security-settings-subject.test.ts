import { describe, expect, it } from "vitest";
import { getSecuritySubjectId } from "@/repository/user-security-settings";

describe("user security settings subject id", () => {
  it("uses a stable subject for the environment admin token session", () => {
    expect(getSecuritySubjectId({ user: { id: -1 } })).toBe("admin-token");
  });

  it("uses the database user id for regular users", () => {
    expect(getSecuritySubjectId({ user: { id: 42 } })).toBe("user:42");
  });
});
