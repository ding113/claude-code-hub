import { describe, expect, test } from "vitest";

/**
 * Live E2E for the group-rate-limit quota-boosts endpoint. Runs against a running
 * server (set API_E2E_BASE_URL to e.g. http://localhost:23000/api/v1); otherwise
 * the suite is skipped. Authenticated cases additionally require TEST_ADMIN_TOKEN
 * (or ADMIN_TOKEN). These cases never create a grant in the shared DB: the only
 * mutation exercised is a request that the validation layer rejects before any write.
 */
const API_E2E_BASE_URL = process.env.API_E2E_BASE_URL;
const run = API_E2E_BASE_URL ? describe : describe.skip;
const TEST_ADMIN_TOKEN = process.env.TEST_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN;
const authedTest = TEST_ADMIN_TOKEN ? test : test.skip;

run("quota-boosts live API (group-rate-limit)", () => {
  test("unauthenticated GET /quota-boosts is rejected with 401", async () => {
    const res = await fetch(`${API_E2E_BASE_URL}/quota-boosts?userId=1`);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    await expect(res.json()).resolves.toMatchObject({ status: 401, errorCode: "auth.missing" });
  });

  authedTest(
    "authenticated GET /quota-boosts routes to the handler and returns items",
    async () => {
      const res = await fetch(`${API_E2E_BASE_URL}/quota-boosts?userId=1`, {
        headers: { Authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items?: unknown };
      expect(Array.isArray(body.items)).toBe(true);
    }
  );

  authedTest("rejects a create payload that violates the datetime-offset contract", async () => {
    const res = await fetch(`${API_E2E_BASE_URL}/quota-boosts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_ADMIN_TOKEN}`,
      },
      // validFrom lacks a timezone offset -> rejected at the schema layer, no DB write.
      body: JSON.stringify({
        userId: 1,
        modelGroupId: 1,
        window: "daily",
        amountUsd: 1,
        validFrom: "2026-06-01T00:00:00",
        validTo: "2026-06-02T00:00:00Z",
      }),
    });
    expect(res.status).toBe(400);
  });
});
