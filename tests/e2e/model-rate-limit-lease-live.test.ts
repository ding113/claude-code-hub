import Redis from "ioredis";
import { afterAll, describe, expect, test } from "vitest";

/**
 * Live E2E for group-rate-limit enforcement. Proves the end-to-end wiring that no
 * unit test can: a real proxy request, routed through the *production* guard
 * pipeline, must create the per-(axis, scope, model group, window) lease in the
 * same Redis the server uses. This guards against both shipped regressions:
 *   - the auth path dropping `users.tags` (tag-derived user_group limits vanish);
 *   - the guard-extension registry not being shared across module instances
 *     (the spliced modelRateLimit guard never runs in the standalone build).
 *
 * Gated on env so it is skipped in CI / local unit runs:
 *   PROXY_E2E_BASE_URL   e.g. http://localhost:23000   (proxy origin, no path)
 *   PROXY_E2E_API_KEY    a key whose user is tagged into a user_group that has a
 *                        model_group_limit on a group containing PROXY_E2E_MODEL
 *   PROXY_E2E_MODEL      a model that belongs to a configured model group
 *   PROXY_E2E_REDIS_URL  Redis the server writes leases to (e.g. redis://localhost:6379)
 * Optional:
 *   PROXY_E2E_EXPECTED_5H_LIMIT  asserts the 5h lease's limitAmount (e.g. "10")
 *
 * The upstream call may legitimately fail (e.g. 503 no_available_providers): the
 * model-limit lease is written by the guard *before* provider selection, so the
 * assertion holds regardless of the upstream outcome.
 */

const BASE_URL = process.env.PROXY_E2E_BASE_URL;
const API_KEY = process.env.PROXY_E2E_API_KEY;
const MODEL = process.env.PROXY_E2E_MODEL;
const REDIS_URL = process.env.PROXY_E2E_REDIS_URL;
const EXPECTED_5H_LIMIT = process.env.PROXY_E2E_EXPECTED_5H_LIMIT;

const configured = Boolean(BASE_URL && API_KEY && MODEL && REDIS_URL);
const run = configured ? describe : describe.skip;

let redis: Redis | null = null;

afterAll(async () => {
  await redis?.quit();
});

run("group-rate-limit live enforcement (model-group lease)", () => {
  test("a proxy request creates a model-group bucket lease in Redis", async () => {
    redis = new Redis(REDIS_URL as string, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();

    const res = await fetch(`${BASE_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY as string,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    // The model-limit guard must not have rejected the request outright; an
    // upstream/provider failure (5xx) is acceptable for this wiring check.
    expect(res.status).not.toBe(429);

    // Leases carry a short DB-refresh TTL, so read immediately after the request.
    const keys = await scanKeys(redis, "lease:*-mg:*");
    expect(keys.length).toBeGreaterThan(0);

    if (EXPECTED_5H_LIMIT) {
      const fiveHourKey = keys.find((k) => k.includes(":5h:"));
      expect(fiveHourKey, "expected a 5h model-group lease key").toBeTruthy();
      const raw = await redis.get(fiveHourKey as string);
      expect(raw).toBeTruthy();
      const lease = JSON.parse(raw as string) as { limitAmount?: number };
      expect(lease.limitAmount).toBe(Number(EXPECTED_5H_LIMIT));
    }
  });
});

async function scanKeys(client: Redis, pattern: string): Promise<string[]> {
  const found: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await client.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = next;
    found.push(...batch);
  } while (cursor !== "0");
  return found;
}
