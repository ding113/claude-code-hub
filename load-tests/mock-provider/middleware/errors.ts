import type { MiddlewareHandler } from "hono";
import type { InjectedErrorType, TestScenario } from "../config/scenarios";
import { sleep } from "../generators/streaming";

function parseNumberHeader(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseErrorTypesHeader(value: string | undefined): InjectedErrorType[] | null {
  if (!value) return null;
  const raw = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const types: InjectedErrorType[] = [];
  for (const item of raw) {
    if (item === "429" || item === "500" || item === "503" || item === "timeout") {
      types.push(item);
    }
  }

  return types.length > 0 ? types : null;
}

function pick<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

async function sleepUntilAbortOrTimeout(signal: AbortSignal, ms: number): Promise<void> {
  if (signal.aborted) return;

  await Promise.race([
    sleep(ms),
    new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    }),
  ]);
}

export const errorInjectionMiddleware: MiddlewareHandler = async (c, next) => {
  const scenario = c.get("scenario") as TestScenario | undefined;

  const headerRate = parseNumberHeader(c.req.header("X-Test-Error-Rate"));
  const headerTypes = parseErrorTypesHeader(c.req.header("X-Test-Error-Types"));

  const rate = Math.max(0, Math.min(1, headerRate ?? scenario?.errorRate ?? 0));
  const types = headerTypes ?? scenario?.errorTypes ?? [];

  if (rate <= 0 || types.length === 0) {
    await next();
    return;
  }

  if (Math.random() >= rate) {
    await next();
    return;
  }

  const errorType = pick(types);
  if (!errorType) {
    await next();
    return;
  }

  // 说明：错误体结构尽量贴近常见上游风格，但只保证“可解析、可压测”。不要在这里做任何复杂逻辑。
  if (errorType === "429") {
    const retryAfter = String(1 + Math.floor(Math.random() * 5));
    c.header("Retry-After", retryAfter);
    return c.json(
      {
        error: {
          message: "Mock rate limit triggered by X-Test-Error-Rate",
          type: "rate_limit_error",
          code: "rate_limit",
        },
      },
      429
    );
  }

  if (errorType === "500") {
    return c.json(
      {
        error: {
          message: "Mock internal error triggered by X-Test-Error-Rate",
          type: "internal_error",
          code: "internal_error",
        },
      },
      500
    );
  }

  if (errorType === "503") {
    return c.json(
      {
        error: {
          message: "Mock overloaded error triggered by X-Test-Error-Rate",
          type: "overloaded_error",
          code: "overloaded",
        },
      },
      503
    );
  }

  // timeout：通过延迟超过常见上游超时阈值来模拟。默认 15s，可按 header 覆盖。
  const headerTimeoutMs = parseNumberHeader(c.req.header("X-Test-Timeout-Ms"));
  const timeoutMs = Math.max(0, Math.floor(headerTimeoutMs ?? 15000));
  await sleepUntilAbortOrTimeout(c.req.raw.signal, timeoutMs);
  return c.json(
    {
      error: {
        message: "Mock timeout triggered by X-Test-Error-Rate",
        type: "timeout_error",
        code: "timeout",
      },
    },
    504
  );
};

