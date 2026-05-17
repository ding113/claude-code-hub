import { describe, expect, test } from "vitest";
import { resolveAuth } from "@/lib/api/v1/_shared/auth-middleware";

function createContext(method = "GET") {
  const request = new Request("http://localhost/api/v1/test", { method });
  return {
    req: {
      method,
      url: request.url,
      raw: request,
      header: (name: string) => request.headers.get(name) ?? undefined,
    },
  };
}

describe("v1 authz policy", () => {
  test("public routes do not require credentials", async () => {
    const result = await resolveAuth(createContext() as never, "public");

    expect(result).not.toBeInstanceOf(Response);
    expect(result).toMatchObject({
      session: null,
      token: null,
      source: "none",
      credentialType: "none",
      allowReadOnlyAccess: true,
    });
  });

  test("read and admin routes reject missing credentials with problem json", async () => {
    for (const tier of ["read", "admin"] as const) {
      const result = await resolveAuth(createContext() as never, tier);

      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(401);
      expect((result as Response).headers.get("content-type")).toContain(
        "application/problem+json"
      );
      await expect((result as Response).json()).resolves.toMatchObject({
        status: 401,
        errorCode: "auth.missing",
      });
    }
  });
});
