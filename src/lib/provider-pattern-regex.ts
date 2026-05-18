// 兼容旧版“通配符”习惯：用户在 regex 模式下输入 glob 风格的 `*` / `?` 时，
// 先按标准正则解析；若解析失败再回退把 `*` 当 `.*`、`?` 当 `.` 处理。
// 这样既保留了已经合法的正则语义（如 `a*`），又能让 `*`、`*.`、`claude-*`
// 这类用户预期的通配符在校验和运行时都被接受。

const GLOB_META = /[*?]/;
const REGEX_META = /[\\^$.|()[\]{}+]/;

export function globPatternToRegexSource(pattern: string): string {
  let out = "";
  for (const ch of pattern) {
    if (ch === "*") {
      out += ".*";
    } else if (ch === "?") {
      out += ".";
    } else if (REGEX_META.test(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return out;
}

export function resolveProviderPatternRegex(
  pattern: string
): { regex: RegExp; source: string } | null {
  try {
    return { regex: new RegExp(pattern), source: pattern };
  } catch {}

  if (!GLOB_META.test(pattern)) {
    return null;
  }

  const globSource = globPatternToRegexSource(pattern);
  try {
    return { regex: new RegExp(globSource), source: globSource };
  } catch {
    return null;
  }
}
