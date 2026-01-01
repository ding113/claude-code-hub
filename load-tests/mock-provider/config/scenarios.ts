export type InjectedErrorType = "429" | "500" | "503" | "timeout";

export type TestScenario = {
  name: string;
  description: string;
  latencyMinMs: number;
  latencyMaxMs: number;
  errorRate: number;
  errorTypes: InjectedErrorType[];
  streamChunkDelayMs: number;
  streamChunkCount: number;
};

export const SCENARIOS: Record<string, TestScenario> = {
  "steady-state": {
    name: "steady-state",
    description: "稳定低延迟、无错误，适合基线压测。",
    latencyMinMs: 30,
    latencyMaxMs: 80,
    errorRate: 0,
    errorTypes: [],
    streamChunkDelayMs: 25,
    streamChunkCount: 24,
  },
  spike: {
    name: "spike",
    description: "延迟波动较大，用于模拟上游抖动与排队。",
    latencyMinMs: 20,
    latencyMaxMs: 1200,
    errorRate: 0,
    errorTypes: [],
    streamChunkDelayMs: 40,
    streamChunkCount: 28,
  },
  "rate-limit-test": {
    name: "rate-limit-test",
    description: "高概率触发 429，用于压测限流与重试逻辑。",
    latencyMinMs: 40,
    latencyMaxMs: 150,
    errorRate: 0.35,
    errorTypes: ["429"],
    streamChunkDelayMs: 20,
    streamChunkCount: 20,
  },
  "circuit-breaker-test": {
    name: "circuit-breaker-test",
    description: "高概率触发 500/503，用于压测熔断与降级。",
    latencyMinMs: 60,
    latencyMaxMs: 220,
    errorRate: 0.4,
    errorTypes: ["500", "503"],
    streamChunkDelayMs: 30,
    streamChunkCount: 22,
  },
  "streaming-stress": {
    name: "streaming-stress",
    description: "大量小分片 + 极短间隔，用于压测 SSE 解析与背压。",
    latencyMinMs: 10,
    latencyMaxMs: 60,
    errorRate: 0,
    errorTypes: [],
    streamChunkDelayMs: 2,
    streamChunkCount: 240,
  },
};

export const DEFAULT_SCENARIO_NAME = "steady-state";
export const DEFAULT_SCENARIO = SCENARIOS[DEFAULT_SCENARIO_NAME];

export function resolveScenario(name: string | null | undefined): TestScenario {
  if (!name) return DEFAULT_SCENARIO;
  return SCENARIOS[name] ?? DEFAULT_SCENARIO;
}

