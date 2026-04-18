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
});
