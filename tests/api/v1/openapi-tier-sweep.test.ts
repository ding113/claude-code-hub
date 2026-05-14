/**
 * Tier-enforcement sweep: with `validateAuthToken` mocked to return a
 * non-admin session, every operation declared `x-required-access: admin`
 * must reject with HTTP 403 (auth.forbidden) before any handler runs.
 *
 * This complements `openapi-auth-sweep.test.ts` (which exercises the same
 * routes without credentials) by proving the middleware also rejects
 * authenticated non-admin callers — the second half of the auth contract.
 */

import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

const { callV1Route } = await import("./test-utils");

const nonAdminSession = {
  user: { id: 99, role: "user", isEnabled: true },
  key: { id: 99, userId: 99, key: "user-token", canLoginWebUi: true },
} as AuthSession;

type Operation = { "x-required-access"?: "public" | "read" | "admin" };
type OpenApiDocument = { paths: Record<string, Record<string, Operation>> };

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

function pathToCallable(path: string): string {
  return path.replace(/\{[^}]+\}/g, "1");
}

async function exerciseAsUser(method: HttpMethod, path: string) {
  return callV1Route({
    method,
    pathname: pathToCallable(path),
    headers: { Authorization: "Bearer user-token" },
    body: method === "GET" || method === "DELETE" ? undefined : {},
  });
}

describe("v1 OpenAPI tier-enforcement sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(nonAdminSession);
  });

  test("every admin-tier operation rejects non-admin authenticated callers with 403", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const document = json as OpenApiDocument;

    const adminOps: Array<{ method: HttpMethod; path: string }> = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, op] of Object.entries(item)) {
        const upper = method.toUpperCase() as HttpMethod;
        if (!HTTP_METHODS.includes(upper)) continue;
        if (op["x-required-access"] !== "admin") continue;
        adminOps.push({ method: upper, path });
      }
    }

    expect(adminOps.length).toBeGreaterThanOrEqual(100);

    const failures: string[] = [];

    for (const op of adminOps) {
      const label = `${op.method} ${op.path}`;
      const result = await exerciseAsUser(op.method, op.path);
      const status = result.response.status;
      const body = result.json as { errorCode?: string; status?: number } | undefined;

      if (status !== 403) {
        failures.push(`${label}: returned ${status} (expected 403 for non-admin caller)`);
        continue;
      }
      if (!result.response.headers.get("content-type")?.includes("application/problem+json")) {
        failures.push(`${label}: 403 missing application/problem+json content-type`);
      }
      // `auth.forbidden` is the standard envelope. `auth.api_key_admin_disabled`
      // is emitted only when the caller uses an API key credential and admin
      // access via API keys is globally disabled — both are valid 403 envelopes.
      if (
        body?.errorCode !== "auth.forbidden" &&
        body?.errorCode !== "auth.api_key_admin_disabled"
      ) {
        failures.push(
          `${label}: 403 errorCode is "${body?.errorCode}" (expected auth.forbidden or auth.api_key_admin_disabled)`
        );
      }
    }

    expect(failures).toEqual([]);
  }, 60000);

  test("non-admin authenticated callers do not get 401 on admin-tier operations (proves credential was accepted)", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const document = json as OpenApiDocument;

    const adminOps: Array<{ method: HttpMethod; path: string }> = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, op] of Object.entries(item)) {
        const upper = method.toUpperCase() as HttpMethod;
        if (!HTTP_METHODS.includes(upper)) continue;
        if (op["x-required-access"] !== "admin") continue;
        adminOps.push({ method: upper, path });
      }
    }

    for (const op of adminOps) {
      const result = await exerciseAsUser(op.method, op.path);
      expect(
        result.response.status,
        `${op.method} ${op.path} returned 401 — credential mock not wired through middleware`
      ).not.toBe(401);
    }
  }, 60000);

  test("read-tier operations accept non-admin callers (no 401 / no 403 at the auth boundary)", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const document = json as OpenApiDocument;

    const readOps: Array<{ method: HttpMethod; path: string }> = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, op] of Object.entries(item)) {
        const upper = method.toUpperCase() as HttpMethod;
        if (!HTTP_METHODS.includes(upper)) continue;
        if (op["x-required-access"] !== "read") continue;
        readOps.push({ method: upper, path });
      }
    }

    const failures: string[] = [];

    for (const op of readOps) {
      const result = await exerciseAsUser(op.method, op.path);
      const status = result.response.status;
      const body = result.json as { errorCode?: string } | undefined;

      if (status === 401) {
        failures.push(`${op.method} ${op.path}: returned 401 (read tier should accept user token)`);
        continue;
      }
      if (status === 403 && body?.errorCode === "auth.forbidden") {
        failures.push(
          `${op.method} ${op.path}: returned auth.forbidden (read tier should not require admin)`
        );
      }
    }

    expect(failures).toEqual([]);
  }, 60000);
});
