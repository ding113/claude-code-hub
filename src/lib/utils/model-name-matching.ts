import { isHostPrefix, stripRegionPrefix } from "@/lib/model-vendor/vendor-inference";

/** openrouter 等网关追加的调用尾缀(":free"、":thinking" 等),匹配时剥除 */
const CALL_SUFFIX_RE = /:(free|thinking|extended|online|nitro|floor|exacto)$/i;

function pushUnique(list: string[], value: string, exclude: string) {
  const candidate = value.trim();
  if (!candidate || candidate === exclude) return;
  if (!list.includes(candidate)) list.push(candidate);
}

/**
 * 生成模型名的回退匹配候选(不含原名),按优先级排列。
 * 处理三类偏差:
 * - "vendor/model" 或 "host/org/model" 带斜杠调用名 -> 去前缀的裸名
 * - bedrock 风格区域/厂商点前缀("us.anthropic.claude-*")
 * - 网关调用尾缀(":thinking" / ":free" 等)
 */
export function buildModelNameFallbackCandidates(modelName: string): string[] {
  const original = modelName.trim();
  if (!original) return [];

  const candidates: string[] = [];
  const seeds = new Set<string>([original]);

  const noSuffix = original.replace(CALL_SUFFIX_RE, "");
  seeds.add(noSuffix);

  for (const seed of Array.from(seeds)) {
    // "org/model":org 为托管商时跳过 org;否则只保留完整段与最后一段
    if (seed.includes("/")) {
      const firstSlash = seed.indexOf("/");
      const org = seed.slice(0, firstSlash);
      if (isHostPrefix(org)) {
        seeds.add(seed.slice(firstSlash + 1));
      }
      seeds.add(seed.slice(seed.lastIndexOf("/") + 1));
    }
  }

  for (const seed of seeds) {
    const stripped = stripRegionPrefix(seed);
    if (stripped !== seed) seeds.add(stripped);
  }

  // 输出顺序:去尾缀原名 -> 去托管前缀 -> 最后一段 -> 区域前缀剥离 -> 小写变体
  pushUnique(candidates, noSuffix, original);
  for (const seed of seeds) {
    pushUnique(candidates, seed, original);
  }
  for (const seed of [original, ...candidates]) {
    pushUnique(candidates, seed.toLowerCase(), original);
  }

  return candidates;
}
