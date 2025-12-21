import packageJson from "../../package.json";

/**
 * 应用版本配置
 * 优先级: NEXT_PUBLIC_APP_VERSION > package.json version
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || `v${packageJson.version}`;

/**
 * GitHub 仓库信息
 * 用于获取最新版本
 */
export const GITHUB_REPO = {
  owner: "ding113",
  repo: "claude-code-hub",
};

type SemverPrereleaseId = { kind: "num"; value: number } | { kind: "str"; value: string };

function parseSemverLike(
  raw: string
): { numbers: number[]; prerelease: SemverPrereleaseId[] | null } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withoutPrefix = trimmed.replace(/^v/i, "");

  // Ignore build metadata.
  const withoutBuild = withoutPrefix.split("+")[0] ?? "";
  if (!withoutBuild) return null;

  const [core, prereleaseRaw] = withoutBuild.split("-", 2);
  if (!core) return null;

  const numberParts = core.split(".").map((part) => {
    const match = part.match(/^\d+/);
    if (!match) return Number.NaN;
    return Number.parseInt(match[0], 10);
  });

  if (numberParts.some((n) => Number.isNaN(n))) {
    return null;
  }

  const prerelease = prereleaseRaw
    ? prereleaseRaw.split(".").map((id) => {
        if (/^\d+$/.test(id)) {
          return { kind: "num" as const, value: Number.parseInt(id, 10) };
        }
        return { kind: "str" as const, value: id };
      })
    : null;

  return { numbers: numberParts, prerelease };
}

/**
 * 比较两个语义化版本号
 * @param current 当前版本 (如 "v1.2.3")
 * @param latest 最新版本 (如 "v1.3.0")
 * @returns 1: latest > current, 0: 相等, -1: current > latest
 *
 * ⚠️ 注意：返回值语义与常见的比较函数相反！
 * - 返回 1 表示 latest 更新（current 需要升级）
 * - 返回 -1 表示 current 更新（current 是较新版本）
 *
 * 推荐使用下面的语义化辅助函数代替直接使用 compareVersions：
 * - isVersionGreater(a, b) - 检查 a 是否比 b 新
 * - isVersionLess(a, b) - 检查 a 是否比 b 旧
 * - isVersionEqual(a, b) - 检查 a 和 b 是否相等
 */
export function compareVersions(current: string, latest: string): number {
  const currentParsed = parseSemverLike(current);
  const latestParsed = parseSemverLike(latest);

  // Fail open: 任何无法解析的版本都视为相等，避免误判导致拦截/提示异常
  if (!currentParsed || !latestParsed) {
    return 0;
  }

  // 1) Compare core numbers.
  for (let i = 0; i < Math.max(currentParsed.numbers.length, latestParsed.numbers.length); i++) {
    const curr = currentParsed.numbers[i] ?? 0;
    const lat = latestParsed.numbers[i] ?? 0;

    if (lat > curr) return 1;
    if (lat < curr) return -1;
  }

  const currPre = currentParsed.prerelease;
  const latPre = latestParsed.prerelease;

  // 2) Core equal: stable > prerelease.
  if (!currPre && !latPre) return 0;
  if (!currPre && latPre) return -1;
  if (currPre && !latPre) return 1;

  // 3) Both prerelease: compare identifiers (SemVer rules).
  for (let i = 0; i < Math.max(currPre!.length, latPre!.length); i++) {
    const currId = currPre![i];
    const latId = latPre![i];

    if (!currId && latId) return 1;
    if (currId && !latId) return -1;
    if (!currId || !latId) return 0;

    if (currId.kind === "num" && latId.kind === "num") {
      if (latId.value > currId.value) return 1;
      if (latId.value < currId.value) return -1;
      continue;
    }

    // Numeric identifiers have lower precedence than non-numeric identifiers.
    if (currId.kind === "num" && latId.kind === "str") return 1;
    if (currId.kind === "str" && latId.kind === "num") return -1;

    if (currId.kind === "str" && latId.kind === "str") {
      if (latId.value > currId.value) return 1;
      if (latId.value < currId.value) return -1;
    }
  }

  return 0;
}

/**
 * 判断版本 a 是否比版本 b 新
 *
 * @param a - 版本 a (如 "1.2.3" 或 "v1.2.3")
 * @param b - 版本 b (如 "1.2.0" 或 "v1.2.0")
 * @returns true 表示 a 比 b 新，false 表示 a 不比 b 新（等于或更旧）
 *
 * @example
 * isVersionGreater("1.2.3", "1.2.0") // true - 1.2.3 比 1.2.0 新
 * isVersionGreater("1.2.0", "1.2.3") // false - 1.2.0 不比 1.2.3 新
 * isVersionGreater("1.2.0", "1.2.0") // false - 相同版本
 */
export function isVersionGreater(a: string, b: string): boolean {
  // compareVersions(a, b) < 0 表示 a > b（a 是较新版本）
  return compareVersions(a, b) < 0;
}

/**
 * 判断版本 a 是否比版本 b 旧
 *
 * @param a - 版本 a (如 "1.2.0" 或 "v1.2.0")
 * @param b - 版本 b (如 "1.2.3" 或 "v1.2.3")
 * @returns true 表示 a 比 b 旧，false 表示 a 不比 b 旧（等于或更新）
 *
 * @example
 * isVersionLess("1.2.0", "1.2.3") // true - 1.2.0 比 1.2.3 旧
 * isVersionLess("1.2.3", "1.2.0") // false - 1.2.3 不比 1.2.0 旧
 * isVersionLess("1.2.0", "1.2.0") // false - 相同版本
 */
export function isVersionLess(a: string, b: string): boolean {
  // compareVersions(a, b) > 0 表示 a < b（a 是较旧版本）
  return compareVersions(a, b) > 0;
}

/**
 * 判断版本 a 和版本 b 是否相等
 *
 * @param a - 版本 a (如 "1.2.0" 或 "v1.2.0")
 * @param b - 版本 b (如 "1.2.0" 或 "v1.2.0")
 * @returns true 表示版本相等，false 表示版本不等
 *
 * @example
 * isVersionEqual("1.2.0", "1.2.0") // true
 * isVersionEqual("v1.2.0", "1.2.0") // true - 忽略 'v' 前缀
 * isVersionEqual("1.2.0", "1.2.3") // false
 */
export function isVersionEqual(a: string, b: string): boolean {
  return compareVersions(a, b) === 0;
}
