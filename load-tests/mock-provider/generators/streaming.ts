export type ChunkStreamOptions = {
  chunkDelayMs: number;
  chunkCount: number;
};

export function formatSSE(event: string | undefined, data: unknown): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  if (event) return `event: ${event}\ndata: ${payload}\n\n`;
  return `data: ${payload}\n\n`;
}

export async function sleep(ms: number): Promise<void> {
  const duration = Math.max(0, Math.floor(ms));
  if (duration === 0) return;
  await new Promise((resolve) => setTimeout(resolve, duration));
}

function splitIntoNChunks(text: string, chunkCount: number): string[] {
  const count = Math.max(1, Math.floor(chunkCount));
  const len = text.length;
  const chunks: string[] = [];

  for (let i = 0; i < count; i += 1) {
    const start = Math.floor((i * len) / count);
    const end = Math.floor(((i + 1) * len) / count);
    chunks.push(text.slice(start, end));
  }

  return chunks.filter((c) => c.length > 0);
}

export async function* streamTextChunks(
  text: string,
  options: ChunkStreamOptions
): AsyncGenerator<string> {
  const chunkDelayMs = Math.max(0, Math.floor(options.chunkDelayMs));
  const chunkCount = Math.max(1, Math.floor(options.chunkCount));

  for (const chunk of splitIntoNChunks(text, chunkCount)) {
    if (chunkDelayMs > 0) await sleep(chunkDelayMs);
    yield chunk;
  }
}

