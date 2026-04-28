import { describe, expect, it } from "vitest";
import { ADMIN_USER_ID } from "@/lib/auth";
import { getSecuritySubjectId } from "@/repository/user-security-settings";

describe("user security settings subject id", () => {
  it("uses a stable subject for the environment admin token session", () => {
    expect(getSecuritySubjectId({ user: { id: ADMIN_USER_ID } })).toBe("admin-token");
  });

  it("uses the database user id for regular users", () => {
    expect(getSecuritySubjectId({ user: { id: 42 } })).toBe("user:42");
  });
});
