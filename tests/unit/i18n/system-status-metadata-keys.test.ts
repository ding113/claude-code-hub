import { describe, expect, test } from "vitest";
import enSystemStatus from "../../../messages/en/systemStatus.json";
import jaSystemStatus from "../../../messages/ja/systemStatus.json";
import ruSystemStatus from "../../../messages/ru/systemStatus.json";
import zhCNSystemStatus from "../../../messages/zh-CN/systemStatus.json";
import zhTWSystemStatus from "../../../messages/zh-TW/systemStatus.json";

describe("messages/<locale>/systemStatus metadata keys", () => {
  test("provides pageTitle/pageDescription", () => {
    const all = [
      enSystemStatus,
      jaSystemStatus,
      ruSystemStatus,
      zhCNSystemStatus,
      zhTWSystemStatus,
    ];

    for (const systemStatus of all) {
      expect(systemStatus).toHaveProperty("pageTitle");
      expect(systemStatus).toHaveProperty("pageDescription");
      expect(typeof systemStatus.pageTitle).toBe("string");
      expect(systemStatus.pageTitle).not.toBe("");
      expect(typeof systemStatus.pageDescription).toBe("string");
      expect(systemStatus.pageDescription).not.toBe("");
    }
  });

  test("provides hero, language switcher and provider status keys", () => {
    const all = [
      enSystemStatus,
      jaSystemStatus,
      ruSystemStatus,
      zhCNSystemStatus,
      zhTWSystemStatus,
    ];

    for (const systemStatus of all) {
      expect(systemStatus).toHaveProperty("hero.titleLineOne");
      expect(systemStatus).toHaveProperty("hero.titleLineTwo");
      expect(systemStatus).toHaveProperty("languageSwitcher.label");
      expect(systemStatus).toHaveProperty("languageSwitcher.defaultHint");
      expect(systemStatus).toHaveProperty("languageSwitcher.options.en.short");
      expect(systemStatus).toHaveProperty("languageSwitcher.options.en.label");
      expect(systemStatus).toHaveProperty("languageSwitcher.options.zhCN.short");
      expect(systemStatus).toHaveProperty("languageSwitcher.options.zhCN.label");
      expect(systemStatus).toHaveProperty("provider.count");
      expect(systemStatus).toHaveProperty("provider.liveAvailability");
      expect(systemStatus).toHaveProperty("provider.noData");
    }
  });
});
