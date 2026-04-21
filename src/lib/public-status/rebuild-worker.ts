const inFlightRebuilds = new Map<string, Promise<{ sourceGeneration: string }>>();

export async function runPublicStatusRebuild(input: {
  flightKey: string;
  computeGeneration: () => Promise<{ sourceGeneration: string }>;
}): Promise<{ sourceGeneration: string }> {
  const existing = inFlightRebuilds.get(input.flightKey);
  if (existing) {
    return existing;
  }

  const promise = Promise.resolve()
    .then(() => input.computeGeneration())
    .finally(() => {
      inFlightRebuilds.delete(input.flightKey);
    });

  inFlightRebuilds.set(input.flightKey, promise);
  return promise;
}

// 调度入口先保持异步语义，后续接入真正的 Redis hint / scheduler 时继续扩展。
export async function schedulePublicStatusRebuild(input: {
  intervalMinutes: number;
  rangeHours: number;
  reason: string;
}): Promise<{
  accepted: boolean;
  rebuildState: string;
}> {
  void input;
  return {
    accepted: true,
    rebuildState: "rebuilding",
  };
}
