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
  // 移除 'v' 前缀
  const cleanCurrent = current.replace(/^v/, "");
  const cleanLatest = latest.replace(/^v/, "");

  const currentParts = cleanCurrent.split(".").map(Number);
  const latestParts = cleanLatest.split(".").map(Number);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const curr = currentParts[i] || 0;
    const lat = latestParts[i] || 0;

    if (lat > curr) return 1;
    if (lat < curr) return -1;
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
