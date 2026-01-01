import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { TestScenario } from "../../../load-tests/mock-provider/config/scenarios";
import { errorInjectionMiddleware } from "../../../load-tests/mock-provider/middleware/errors";
import { latencyMiddleware } from "../../../load-tests/mock-provider/middleware/latency";

describe("mock-provider middleware", () => {
  test("latencyMiddleware 支持 min=max=0（无等待）", async () => {
    const scenario: TestScenario = {
      name: "unit-test",
      description: "用于单测。",
      latencyMinMs: 0,
      latencyMaxMs: 0,
      errorRate: 0,
      errorTypes: [],
      streamChunkDelayMs: 0,
      streamChunkCount: 1,
    };

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("scenario", scenario);
      await next();
    });
    app.use("*", latencyMiddleware);
    app.get("/ok", (c) => c.text("ok"));

    const res = await app.request("/ok", {
      headers: { "X-Test-Latency-Min": "0", "X-Test-Latency-Max": "0" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("errorInjectionMiddleware 429", async () => {
    const scenario: TestScenario = {
      name: "unit-test",
      description: "用于单测。",
      latencyMinMs: 0,
      latencyMaxMs: 0,
      errorRate: 0,
      errorTypes: [],
      streamChunkDelayMs: 0,
      streamChunkCount: 1,
    };

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("scenario", scenario);
      await next();
    });
    app.use("*", errorInjectionMiddleware);
    app.get("/ok", (c) => c.text("ok"));

    const res = await app.request("/ok", {
      headers: { "X-Test-Error-Rate": "1", "X-Test-Error-Types": "429" },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  test("errorInjectionMiddleware timeout（0ms）", async () => {
    const scenario: TestScenario = {
      name: "unit-test",
      description: "用于单测。",
      latencyMinMs: 0,
      latencyMaxMs: 0,
      errorRate: 0,
      errorTypes: [],
      streamChunkDelayMs: 0,
      streamChunkCount: 1,
    };

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("scenario", scenario);
      await next();
    });
    app.use("*", errorInjectionMiddleware);
    app.get("/ok", (c) => c.text("ok"));

    const res = await app.request("/ok", {
      headers: {
        "X-Test-Error-Rate": "1",
        "X-Test-Error-Types": "timeout",
        "X-Test-Timeout-Ms": "0",
      },
    });
    expect(res.status).toBe(504);
  });
});
