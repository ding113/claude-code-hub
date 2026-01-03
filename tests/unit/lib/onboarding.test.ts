import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetAllOnboarding,
  resetOnboarding,
  setOnboardingCompleted,
  shouldShowOnboarding,
} from "@/lib/onboarding";

function createMemoryLocalStorage() {
  const store = new Map<string, string>();

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

afterEach(() => {
  // 清理测试中注入的全局对象，避免污染其他测试
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).localStorage;
});

describe("onboarding", () => {
  beforeEach(() => {
    // 在某些测试环境（例如 DOM 仿真环境）下，window/localStorage 可能默认存在
    // 为了让“SSR 环境”用例稳定，这里在每个用例开始前都强制清理一次
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).localStorage;
  });

  it("SSR 环境下不显示引导", () => {
    expect(shouldShowOnboarding("webhookMigration")).toBe(false);
  });

  it("正常流程：未完成时显示，完成后不再显示，可重置", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).localStorage = createMemoryLocalStorage();

    expect(shouldShowOnboarding("webhookMigration")).toBe(true);

    setOnboardingCompleted("webhookMigration");
    expect(shouldShowOnboarding("webhookMigration")).toBe(false);

    resetOnboarding("webhookMigration");
    expect(shouldShowOnboarding("webhookMigration")).toBe(true);
  });

  it("resetAllOnboarding 会清空所有类型的状态", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).localStorage = createMemoryLocalStorage();

    setOnboardingCompleted("userManagement");
    setOnboardingCompleted("webhookMigration");
    setOnboardingCompleted("providerSetup");
    setOnboardingCompleted("quotaManagement");

    expect(shouldShowOnboarding("userManagement")).toBe(false);
    expect(shouldShowOnboarding("webhookMigration")).toBe(false);
    expect(shouldShowOnboarding("providerSetup")).toBe(false);
    expect(shouldShowOnboarding("quotaManagement")).toBe(false);

    resetAllOnboarding();

    expect(shouldShowOnboarding("userManagement")).toBe(true);
    expect(shouldShowOnboarding("webhookMigration")).toBe(true);
    expect(shouldShowOnboarding("providerSetup")).toBe(true);
    expect(shouldShowOnboarding("quotaManagement")).toBe(true);
  });

  it("localStorage 抛错时应静默失败且不崩溃", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).localStorage = {
      getItem: () => {
        throw new Error("getItem failed");
      },
      setItem: () => {
        throw new Error("setItem failed");
      },
      removeItem: () => {
        throw new Error("removeItem failed");
      },
    };

    expect(shouldShowOnboarding("webhookMigration")).toBe(false);
    expect(() => setOnboardingCompleted("webhookMigration")).not.toThrow();
    expect(() => resetOnboarding("webhookMigration")).not.toThrow();
    expect(() => resetAllOnboarding()).not.toThrow();
  });
});
