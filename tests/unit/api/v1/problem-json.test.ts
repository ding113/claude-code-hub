import { describe, expect, test } from "vitest";
import { createProblemJson, createProblemResponse } from "@/lib/api/v1/_shared/error-envelope";

describe("v1 problem json", () => {
  test("creates RFC 9457-compatible problem documents with i18n fields", async () => {
    const response = createProblemResponse({
      status: 400,
      instance: "/api/v1/users",
      errorCode: "user.name_required",
      errorParams: { field: "name" },
      detail: "User name is required.",
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    await expect(response.json()).resolves.toMatchObject({
      type: "urn:claude-code-hub:problem:user.name_required",
      title: "Bad request",
      status: 400,
      detail: "User name is required.",
      instance: "/api/v1/users",
      errorCode: "user.name_required",
      errorParams: { field: "name" },
    });
  });

  test("fills status-specific defaults", () => {
    expect(createProblemJson({ status: 401 })).toMatchObject({
      title: "Unauthorized",
      errorCode: "auth.invalid",
      detail: "Unauthorized",
    });
  });
});
