import type { PublicStatusModelConfig } from "@/lib/public-status/config";

export function normalizePublicStatusModels(
  publicModels: PublicStatusModelConfig[]
): PublicStatusModelConfig[] {
  const seen = new Set<string>();
  const normalized: PublicStatusModelConfig[] = [];

  for (const model of publicModels) {
    const modelKey = model.modelKey.trim();
    if (!modelKey || seen.has(modelKey)) {
      continue;
    }

    seen.add(modelKey);
    normalized.push({
      modelKey,
      ...(model.providerTypeOverride ? { providerTypeOverride: model.providerTypeOverride } : {}),
    });
  }

  return normalized;
}

export function syncSelectedPublicStatusModels(
  currentModels: PublicStatusModelConfig[],
  selectedModelKeys: string[]
): PublicStatusModelConfig[] {
  const currentByKey = new Map(currentModels.map((model) => [model.modelKey, model] as const));

  // 保留用户已经选过的 provider override；只为新增模型补空壳。
  return normalizePublicStatusModels(
    selectedModelKeys.map((modelKey) => {
      const existing = currentByKey.get(modelKey);
      return existing
        ? existing
        : {
            modelKey,
          };
    })
  );
}
