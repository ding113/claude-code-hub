import { afterEach, describe, expect, test, vi } from "vitest";
import { callActionsRoute } from "../../../test-utils";

function expectManagementSecurityHeaders(response: Response) {
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  expect(response.headers.get("content-security-policy-report-only")).toContain(
    "frame-ancestors 'none'"
  );
  expect(response.headers.get("cache-control")).toContain("no-store");
}

async function callFreshActionsRoute(
  pathname: string,
  method: "GET" | "POST" = "POST"
): Promise<Response> {
  vi.resetModules();
  const route = await import("@/app/api/actions/[...route]/route");
  return route[method](
    new Request(new URL(pathname, "http://localhost"), {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
    })
  );
}

describe("legacy actions API deprecation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("adds deprecation headers by default without changing body shape", async () => {
    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/users/getUsers",
      body: {},
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("Deprecation")).toBe("@1777420800");
    expect(response.headers.get("Sunset")).toBe("Thu, 31 Dec 2026 00:00:00 GMT");
    expect(response.headers.get("Link")).toContain("/api/v1/openapi.json");
    expect(response.headers.get("Warning")).toContain("/api/actions API is deprecated");
    expectManagementSecurityHeaders(response);
    expect(json).toMatchObject({ ok: false });
  });

  test("returns 410 problem+json when legacy execution is disabled", async () => {
    vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "false");

    const response = await callFreshActionsRoute("/api/actions/users/getUsers");
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expectManagementSecurityHeaders(response);
    expect(body).toMatchObject({
      status: 410,
      errorCode: "api.legacy_actions_gone",
      instance: "/api/actions/users/getUsers",
    });
  });

  test("keeps legacy docs available when execution is disabled but docs mode is deprecated", async () => {
    vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "false");
    vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "deprecated");

    const response = await callFreshActionsRoute("/api/actions/openapi.json", "GET");

    expect(response.status).toBe(200);
    expect(response.headers.get("Deprecation")).toBe("@1777420800");
    expect(response.headers.get("Link")).toContain("/api/v1/openapi.json");
    expectManagementSecurityHeaders(response);
  });

  test.each([
    "/api/actions/docs",
    "/api/actions/scalar",
  ])("keeps legacy docs UI %s available when execution is disabled but docs mode is deprecated", async (pathname) => {
    vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "false");
    vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "deprecated");

    const response = await callFreshActionsRoute(pathname, "GET");

    expect(response.status).toBe(200);
    expect(response.headers.get("Deprecation")).toBe("@1777420800");
    expect(response.headers.get("Link")).toContain("/api/v1/openapi.json");
    expectManagementSecurityHeaders(response);
  });

  test("keeps deprecation date stable when sunset date is overridden", async () => {
    vi.stubEnv("LEGACY_ACTIONS_SUNSET_DATE", "2027-01-15");

    const response = await callFreshActionsRoute("/api/actions/users/getUsers");

    expect(response.headers.get("Deprecation")).toBe("@1777420800");
    expect(response.headers.get("Sunset")).toBe("Fri, 15 Jan 2027 00:00:00 GMT");
  });

  test("can hide legacy docs independently with the docs mode flag", async () => {
    vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "true");
    vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "hidden");

    const response = await callFreshActionsRoute("/api/actions/openapi.json", "GET");
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toMatchObject({
      status: 410,
      errorCode: "api.legacy_actions_gone",
      instance: "/api/actions/openapi.json",
    });
  });

  test.each([
    "/api/actions/docs",
    "/api/actions/scalar",
  ])("can hide legacy docs UI %s independently with the docs mode flag", async (pathname) => {
    vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "true");
    vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "hidden");

    const response = await callFreshActionsRoute(pathname, "GET");
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toMatchObject({
      status: 410,
      errorCode: "api.legacy_actions_gone",
      instance: pathname,
    });
  });
});
