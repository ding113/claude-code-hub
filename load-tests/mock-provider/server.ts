import { Hono } from "hono";
import { resolveScenario } from "./config/scenarios";
import { registerClaudeRoutes } from "./handlers/claude";
import { registerCodexRoutes } from "./handlers/codex";
import { registerOpenAIRoutes } from "./handlers/openai";
import { errorInjectionMiddleware } from "./middleware/errors";
import { latencyMiddleware } from "./middleware/latency";

export function createMockProviderApp(): Hono {
  const app = new Hono();

  // 场景切换：优先从 X-Test-Scenario 读取，否则走默认场景
  app.use("*", async (c, next) => {
    const scenarioName = c.req.header("X-Test-Scenario");
    const scenario = resolveScenario(scenarioName);
    c.set("scenario", scenario);
    await next();
  });

  // 注入顺序：延迟 → 错误。这样错误响应也会带上延迟，更接近真实上游。
  app.use("*", latencyMiddleware);
  app.use("*", errorInjectionMiddleware);

  registerClaudeRoutes(app);
  registerOpenAIRoutes(app);
  registerCodexRoutes(app);

  app.get("/health", (c) => {
    const scenarioName = c.req.header("X-Test-Scenario");
    const scenario = resolveScenario(scenarioName);
    return c.json({
      ok: true,
      service: "cch-mock-provider",
      scenario: scenario.name,
    });
  });

  return app;
}

export function startMockProviderServer(port = 3001): void {
  const app = createMockProviderApp();
  const bun = (globalThis as unknown as { Bun?: { serve?: (args: unknown) => unknown } }).Bun;

  if (!bun?.serve) {
    throw new Error(
      "无法启动 mock-provider：当前运行时不是 Bun。请使用 `bun run load-tests/mock-provider/server.ts` 启动。"
    );
  }

  bun.serve({
    port,
    fetch: app.fetch,
  });

  // 这里保留 console 输出，便于压测时快速定位服务地址。
  console.log(`[mock-provider] listening on http://localhost:${port}`);
}

const app = createMockProviderApp();

// Bun 支持 import.meta.main，用于判断入口执行；这样被测试/工具导入时不会自动启动监听。
if (import.meta.main) {
  startMockProviderServer(3001);
}

export default app;
