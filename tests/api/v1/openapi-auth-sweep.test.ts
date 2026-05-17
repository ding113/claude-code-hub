/**
 * Live OpenAPI sweep — for every operation declared in /api/v1/openapi.json,
 * exercise the route against the in-process Hono app and confirm:
 *   - operations declared `x-required-access: public` are reachable without auth
 *     (any status other than 401 is accepted; the contract test already
 *     validates the spec-level metadata)
 *   - operations declared `x-required-access: read` or `admin` return 401 with
 *     the `auth.missing` problem+json envelope when called without credentials
 *
 * The companion `openapi-tier-sweep.test.ts` uses mocked auth to verify that
 * the documented tier matches the actually enforced tier (admin endpoints
 * 403 for non-admins, read endpoints accept user keys, etc.).
 */

import { describe, expect, test } from "vitest";
import { callV1Route } from "./test-utils";

type Operation = {
  "x-required-access"?: "public" | "read" | "admin";
  operationId?: string;
  security?: unknown[];
};

type OpenApiDocument = {
  paths: Record<string, Record<string, Operation>>;
};

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

function pathToCallable(path: string): string {
  // Convert OpenAPI templated paths like /users/{id}/keys -> concrete probe paths.
  // The auth middleware runs before route-param validation, so any non-empty
  // value works as a placeholder.
  return path.replace(/\{[^}]+\}/g, "1");
}

async function exerciseWithoutAuth(method: HttpMethod, path: string) {
  return callV1Route({
    method,
    pathname: pathToCallable(path),
    body: method === "GET" || method === "DELETE" ? undefined : {},
  });
}

describe("v1 OpenAPI live auth sweep", () => {
  test("every operation enforces its documented x-required-access tier when called without credentials", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const document = json as OpenApiDocument;

    const operations: Array<{ method: HttpMethod; path: string; tier: string }> = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, op] of Object.entries(item)) {
        const upper = method.toUpperCase() as HttpMethod;
        if (!HTTP_METHODS.includes(upper)) continue;
        operations.push({
          method: upper,
          path,
          tier: String(op["x-required-access"] ?? "missing"),
        });
      }
    }

    // sanity: we should be sweeping a non-trivial surface
    expect(operations.length).toBeGreaterThanOrEqual(150);

    const failures: string[] = [];

    for (const op of operations) {
      const label = `${op.tier.toUpperCase()} ${op.method} ${op.path}`;
      const probeResult = await exerciseWithoutAuth(op.method, op.path);
      const status = probeResult.response.status;
      const contentType = probeResult.response.headers.get("content-type") ?? "";

      if (op.tier === "public") {
        // Public endpoints must NOT challenge with 401.
        if (status === 401) {
          failures.push(`${label}: public endpoint returned 401 (should not require auth)`);
        }
        continue;
      }

      if (op.tier === "read" || op.tier === "admin") {
        if (status !== 401) {
          failures.push(
            `${label}: protected endpoint returned ${status} (expected 401 without auth)`
          );
          continue;
        }
        if (!contentType.includes("application/problem+json")) {
          failures.push(
            `${label}: 401 content-type is "${contentType}" (expected application/problem+json)`
          );
        }
        const body = probeResult.json as { errorCode?: string; status?: number };
        if (body?.errorCode !== "auth.missing") {
          failures.push(`${label}: 401 errorCode is "${body?.errorCode}" (expected auth.missing)`);
        }
        if (body?.status !== 401) {
          failures.push(`${label}: 401 body status is ${body?.status} (expected 401)`);
        }
        continue;
      }

      failures.push(`${label}: missing or unrecognized x-required-access`);
    }

    expect(failures).toEqual([]);
  }, 60000);

  test("public operations remain documented as public and reachable", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const document = json as OpenApiDocument;

    const publicOps: Array<{ method: HttpMethod; path: string }> = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, op] of Object.entries(item)) {
        if (op["x-required-access"] !== "public") continue;
        publicOps.push({ method: method.toUpperCase() as HttpMethod, path });
      }
    }

    // Public endpoints currently expected: /health and /public/status. If the
    // count changes we want the contract test below to surface it explicitly.
    expect(publicOps.length).toBeGreaterThanOrEqual(2);

    for (const op of publicOps) {
      const result = await exerciseWithoutAuth(op.method, op.path);
      // Any 2xx-3xx-4xx is acceptable except 401, which would indicate the
      // endpoint requires auth contrary to its declaration. Public endpoints
      // may legitimately return 400 (bad query), 503 (degraded), etc.
      expect(
        result.response.status,
        `${op.method} ${op.path} returned 401 despite being public`
      ).not.toBe(401);
    }
  });

  test("the documented set of public operations is the expected allow-list", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const document = json as OpenApiDocument;

    const publicOps: string[] = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, op] of Object.entries(item)) {
        if (op["x-required-access"] !== "public") continue;
        publicOps.push(`${method.toUpperCase()} ${path}`);
      }
    }

    // Only health and public status are intentionally public. Any new public
    // endpoint must be added here explicitly so the security boundary is
    // reviewed.
    expect(publicOps.sort()).toEqual(["GET /api/v1/health", "GET /api/v1/public/status"].sort());
  });
});
