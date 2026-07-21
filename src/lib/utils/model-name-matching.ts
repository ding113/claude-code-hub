import { isHostPrefix, stripRegionPrefix } from "@/lib/model-vendor/vendor-inference";

/** openrouter 等网关追加的调用尾缀(":free"、":thinking" 等),匹配时剥除 */
const CALL_SUFFIX_RE = /:(free|thinking|extended|online|nitro|floor|exacto)$/i;

/**
 * 中转/网关常见模型尾缀（连字符形式）。
 * e.g. grok-4.5-build-free → grok-4.5 so health-test pricing can fall back.
 */
const HYPHEN_MODEL_SUFFIXES = [
  "build-free",
  "build",
  "free",
  "paid",
  "pro",
  "plus",
  "preview",
  "experimental",
  "exp",
  "latest",
  "stable",
  "beta",
  "alpha",
  "fast",
  "turbo",
  "mini",
  "nano",
  "high",
  "low",
  "medium",
] as const;

function pushUnique(list: string[], value: string, exclude: string) {
  const candidate = value.trim();
  if (!candidate || candidate === exclude) return;
  if (!list.includes(candidate)) list.push(candidate);
}

function stripHyphenModelSuffixes(name: string): string[] {
  const out: string[] = [];
  let current = name;
  // Peel repeatedly: foo-build-free → foo-build → foo
  for (let guard = 0; guard < 6; guard += 1) {
    let stripped: string | null = null;
    for (const suffix of HYPHEN_MODEL_SUFFIXES) {
      const re = new RegExp(`[-_.]${suffix}$`, "i");
      if (re.test(current)) {
        stripped = current.replace(re, "");
        break;
      }
    }
    if (!stripped || stripped === current || stripped.length < 2) break;
    current = stripped;
    out.push(current);
  }
  return out;
}

/**
 * 生成模型名的回退匹配候选(不含原名),按优先级排列。
 * 处理四类偏差:
 * - "vendor/model" 或 "host/org/model" 带斜杠调用名 -> 去前缀的裸名
 * - bedrock 风格区域/厂商点前缀("us.anthropic.claude-*")
 * - 网关调用尾缀(":thinking" / ":free" 等)
 * - 中转变体尾缀("-build-free" / "-pro" 等) → 基础模型名
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

  for (const seed of Array.from(seeds)) {
    const stripped = stripRegionPrefix(seed);
    if (stripped !== seed) seeds.add(stripped);
  }

  // Hyphen/dot channel suffixes: grok-4.5-build-free → grok-4.5
  for (const seed of Array.from(seeds)) {
    for (const peeled of stripHyphenModelSuffixes(seed)) {
      seeds.add(peeled);
    }
  }

  // 输出顺序:去尾缀原名 -> 去托管前缀 -> 最后一段 -> 区域前缀剥离 -> 变体尾缀 -> 小写变体
  pushUnique(candidates, noSuffix, original);
  for (const seed of seeds) {
    pushUnique(candidates, seed, original);
  }
  for (const seed of [original, ...candidates]) {
    pushUnique(candidates, seed.toLowerCase(), original);
  }

  return candidates;
}
