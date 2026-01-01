import type { MiddlewareHandler } from "hono";
import type { TestScenario } from "../config/scenarios";
import { sleep } from "../generators/streaming";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseIntHeader(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function randomNormal(): number {
  // Box–Muller transform：生成均值为 0、方差为 1 的正态分布随机数
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function gaussianMs(minMs: number, maxMs: number): number {
  const min = Math.min(minMs, maxMs);
  const max = Math.max(minMs, maxMs);
  const mean = (min + max) / 2;

  // 经验：让 3σ 覆盖区间（99.7% 落在范围内），并在最终做 clamp
  const std = Math.max(1, (max - min) / 6);
  const sampled = mean + randomNormal() * std;
  return Math.round(clamp(sampled, min, max));
}

export const latencyMiddleware: MiddlewareHandler = async (c, next) => {
  const scenario = c.get("scenario") as TestScenario | undefined;

  const headerMin = parseIntHeader(c.req.header("X-Test-Latency-Min"));
  const headerMax = parseIntHeader(c.req.header("X-Test-Latency-Max"));

  const minMs = headerMin ?? scenario?.latencyMinMs ?? 50;
  const maxMs = headerMax ?? scenario?.latencyMaxMs ?? 200;

  const delayMs = gaussianMs(minMs, maxMs);
  await sleep(delayMs);
  await next();
};

