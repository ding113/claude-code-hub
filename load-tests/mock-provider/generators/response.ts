export type UsageMetrics = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
};

function safeNumber(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

function extractText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join("\n");

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;

    // Claude/OpenAI 常见结构：{ text: "..." }
    if (typeof obj.text === "string") return obj.text;

    // OpenAI：{ content: "..." } 或 Claude：{ content: [...] }
    if (obj.content) return extractText(obj.content);

    // Responses API：{ input_text: "..." }
    if (typeof obj.input_text === "string") return obj.input_text;

    // Responses API：{ content: [{ type: "output_text", text: "..." }] }
    if (obj.output && Array.isArray(obj.output)) return extractText(obj.output);

    return "";
  }

  return "";
}

export function estimateInputTokens(messages: unknown): number {
  const text = extractText(messages);

  // 经验估算：英文约 4 字符/Token，中文通常更密，这里只追求稳定与可控。
  const estimated = Math.ceil(text.length / 4);
  return Math.max(1, estimated);
}

export function generateOutputText(tokenCount: number): string {
  const count = Math.max(0, Math.floor(safeNumber(tokenCount, 0)));
  if (count === 0) return "";

  const header =
    "这是用于压测的模拟回复，不保证语义正确，只用于产生稳定的输出与流式分片行为。";
  const words = [
    "mock",
    "provider",
    "load",
    "test",
    "stream",
    "chunk",
    "latency",
    "error",
    "scenario",
    "throughput",
    "backpressure",
    "sse",
    "proxy",
    "retry",
    "timeout",
    "circuit",
    "breaker",
    "token",
    "usage",
    "metrics",
  ];

  const body = Array.from({ length: count }, (_, i) => words[i % words.length]).join(" ");
  return `${header}\n\n${body}`;
}

export function createUsage(inputTokens: number, outputTokens: number): UsageMetrics {
  const input = Math.max(0, Math.floor(safeNumber(inputTokens, 0)));
  const output = Math.max(0, Math.floor(safeNumber(outputTokens, 0)));
  const total = input + output;

  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: total,
    prompt_tokens: input,
    completion_tokens: output,
  };
}

