// 兼容旧版“通配符”习惯：用户在 regex 模式下输入 glob 风格的 `*` / `?` 时，
// 先按标准正则解析；若解析失败再回退把 `*` 当 `.*`、`?` 当 `.` 处理。
// 这样既保留了已经合法的正则语义（如 `a*`），又能让 `*`、`*.`、`*-opus-*`
// 这类用户预期的通配符在校验和运行时都被接受。
//
// Glob fallback 路径下会在最终的正则两端加 `^...$`，让通配符语义贴近 shell glob
// 的整串匹配（用户写 `*.foo` 时期望“以 `.foo` 结尾”，而不是 `bar.foo.baz` 这样
// 子串包含也算匹配）。原本就合法的正则保持子串匹配语义不变。

const GLOB_META = /[*?]/;
const REGEX_META = /[\\^$.|()[\]{}+]/g;

type Compiled = { regex: RegExp; source: string };

// matchesPattern 在每次调度里都会调到这里，缓存避免重复 `new RegExp`。
// pattern 是用户配置项、规模有限，但仍设上限防御异常增长。
const CACHE_LIMIT = 1024;
const cache = new Map<string, Compiled | null>();

export function globPatternToRegexSource(pattern: string): string {
  return pattern.replace(REGEX_META, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
}

export function resolveProviderPatternRegex(pattern: string): Compiled | null {
  if (cache.has(pattern)) {
    return cache.get(pattern) ?? null;
  }

  let result: Compiled | null = null;
  try {
    result = { regex: new RegExp(pattern), source: pattern };
  } catch {}

  if (!result && GLOB_META.test(pattern)) {
    const globSource = `^${globPatternToRegexSource(pattern)}$`;
    try {
      result = { regex: new RegExp(globSource), source: globSource };
    } catch {}
  }

  if (cache.size >= CACHE_LIMIT) {
    cache.clear();
  }
  cache.set(pattern, result);
  return result;
}
