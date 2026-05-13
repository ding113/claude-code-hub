import { describe, expect, test } from "vitest";

const API_E2E_BASE_URL = process.env.API_E2E_BASE_URL;
const run = API_E2E_BASE_URL ? describe : describe.skip;
const TEST_ADMIN_TOKEN = process.env.TEST_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN;
const authedTest = TEST_ADMIN_TOKEN ? test : test.skip;

run("v1 management REST API live smoke", () => {
  test("serves health and OpenAPI documents from the running server", async () => {
    const health = await fetch(`${API_E2E_BASE_URL}/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get("X-API-Version")).toBe("1.0.0");
    await expect(health.json()).resolves.toMatchObject({
      status: "ok",
      apiVersion: "1.0.0",
    });

    const openapi = await fetch(`${API_E2E_BASE_URL}/openapi.json`);
    expect(openapi.status).toBe(200);
    expect(openapi.headers.get("X-API-Version")).toBe("1.0.0");
    await expect(openapi.json()).resolves.toMatchObject({
      openapi: "3.1.0",
      info: { title: "Claude Code Hub Management API", version: "1.0.0" },
    });
  });

  test("routes real resource reads and mutations through the live v1 handler", async () => {
    const providers = await fetch(`${API_E2E_BASE_URL}/providers`);
    expect(providers.status).toBe(401);
    expect(providers.headers.get("content-type")).toContain("application/problem+json");
    await expect(providers.json()).resolves.toMatchObject({
      status: 401,
      errorCode: "auth.missing",
    });

    const userCreate = await fetch(`${API_E2E_BASE_URL}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "smoke-user" }),
    });
    expect(userCreate.status).toBe(401);
    expect(userCreate.headers.get("content-type")).toContain("application/problem+json");
    await expect(userCreate.json()).resolves.toMatchObject({
      status: 401,
      errorCode: "auth.missing",
    });
  });

  authedTest("routes an authenticated read through a live resource handler", async () => {
    const timezone = await fetch(`${API_E2E_BASE_URL}/system/timezone`, {
      headers: { Authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
    });

    expect(timezone.status).toBe(200);
    expect(timezone.headers.get("X-API-Version")).toBe("1.0.0");
    await expect(timezone.json()).resolves.toMatchObject({
      timeZone: expect.any(String),
    });
  });
});
