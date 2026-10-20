/**
 * 以固定并发度遍历任务，保持结果顺序与输入一致。
 *
 * 余额探测会同时对多个上游发起请求，不加限制会在供应商较多时打满连接数。
 */
export async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  limit: number,
  worker: (item: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  if (items.length === 0) return results;

  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  const runners = Array.from({ length: effectiveLimit }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as TInput, index);
    }
  });

  await Promise.all(runners);
  return results;
}
