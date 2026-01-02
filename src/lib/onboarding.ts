/**
 * Onboarding 引导工具
 *
 * 用于跟踪用户是否已完成特定的引导流程。
 * 使用 localStorage 存储状态，仅在客户端环境下可用。
 */

const ONBOARDING_PREFIX = "claude-code-hub-onboarding";

/**
 * 支持的引导类型
 */
export type OnboardingType =
  | "userManagement"
  | "webhookMigration"
  | "providerSetup"
  | "quotaManagement";

/**
 * 获取指定引导类型的 localStorage key
 */
function getStorageKey(type: OnboardingType): string {
  return `${ONBOARDING_PREFIX}:${type}`;
}

/**
 * 检查是否应该显示指定的引导流程
 *
 * @param type - 引导类型
 * @returns 如果应该显示引导则返回 true
 */
export function shouldShowOnboarding(type: OnboardingType): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const value = localStorage.getItem(getStorageKey(type));
    // 如果没有记录或记录为 false，则显示引导
    return value !== "true";
  } catch {
    // localStorage 不可用时，默认不显示
    return false;
  }
}

/**
 * 标记指定的引导流程已完成
 *
 * @param type - 引导类型
 */
export function setOnboardingCompleted(type: OnboardingType): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(getStorageKey(type), "true");
  } catch {
    // localStorage 不可用时静默失败
  }
}

/**
 * 重置指定的引导流程（用于测试或需要重新显示时）
 *
 * @param type - 引导类型
 */
export function resetOnboarding(type: OnboardingType): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.removeItem(getStorageKey(type));
  } catch {
    // localStorage 不可用时静默失败
  }
}

/**
 * 重置所有引导流程
 */
export function resetAllOnboarding(): void {
  if (typeof window === "undefined") {
    return;
  }

  const types: OnboardingType[] = [
    "userManagement",
    "webhookMigration",
    "providerSetup",
    "quotaManagement",
  ];

  for (const type of types) {
    resetOnboarding(type);
  }
}
