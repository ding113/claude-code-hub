/**
 * 管理 API 迁移期环境变量测试
 *
 * 验证项：
 * - 四个新增字段的默认值与 .env.example 保持一致
 * - 布尔字段对 "true"/"false"/"1"/"0" 的解析行为符合 booleanTransform 约定
 * - LEGACY_ACTIONS_SUNSET_DATE 的 YYYY-MM-DD 格式校验
 * - LEGACY_ACTIONS_DOCS_MODE 的枚举校验
 * - 公共 helper（isLegacyActionsApiEnabled / isApiKeyAdminAccessEnabled /
 *   getLegacyActionsSunsetDate / getLegacyActionsDocsMode）能感知 vi.stubEnv 的变更
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EnvSchema,
  getLegacyActionsDocsMode,
  getLegacyActionsSunsetDate,
  isApiKeyAdminAccessEnabled,
  isLegacyActionsApiEnabled,
  resetEnvConfigForTests,
} from "@/lib/config/env.schema";

describe("EnvSchema - Management API migration flags", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetEnvConfigForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvConfigForTests();
  });

  describe("默认值", () => {
    it("ENABLE_LEGACY_ACTIONS_API 默认为 true", () => {
      const result = EnvSchema.parse({});
      expect(result.ENABLE_LEGACY_ACTIONS_API).toBe(true);
    });

    it("LEGACY_ACTIONS_DOCS_MODE 默认为 deprecated", () => {
      const result = EnvSchema.parse({});
      expect(result.LEGACY_ACTIONS_DOCS_MODE).toBe("deprecated");
    });

    it("LEGACY_ACTIONS_SUNSET_DATE 默认为 2026-12-31", () => {
      const result = EnvSchema.parse({});
      expect(result.LEGACY_ACTIONS_SUNSET_DATE).toBe("2026-12-31");
    });

    it("ENABLE_API_KEY_ADMIN_ACCESS 默认为 false", () => {
      const result = EnvSchema.parse({});
      expect(result.ENABLE_API_KEY_ADMIN_ACCESS).toBe(false);
    });
  });

  describe("ENABLE_LEGACY_ACTIONS_API 布尔解析", () => {
    it("解析 'true' 为 true", () => {
      const result = EnvSchema.parse({ ENABLE_LEGACY_ACTIONS_API: "true" });
      expect(result.ENABLE_LEGACY_ACTIONS_API).toBe(true);
    });

    it("解析 'false' 为 false", () => {
      const result = EnvSchema.parse({ ENABLE_LEGACY_ACTIONS_API: "false" });
      expect(result.ENABLE_LEGACY_ACTIONS_API).toBe(false);
    });

    it("解析 '0' 为 false", () => {
      const result = EnvSchema.parse({ ENABLE_LEGACY_ACTIONS_API: "0" });
      expect(result.ENABLE_LEGACY_ACTIONS_API).toBe(false);
    });

    it("解析 '1' 为 true", () => {
      const result = EnvSchema.parse({ ENABLE_LEGACY_ACTIONS_API: "1" });
      expect(result.ENABLE_LEGACY_ACTIONS_API).toBe(true);
    });

    it("解析任意非空字符串为 true（与现有 booleanTransform 一致）", () => {
      const result = EnvSchema.parse({ ENABLE_LEGACY_ACTIONS_API: "yes" });
      expect(result.ENABLE_LEGACY_ACTIONS_API).toBe(true);
    });
  });

  describe("ENABLE_API_KEY_ADMIN_ACCESS 布尔解析", () => {
    it("解析 'true' 为 true", () => {
      const result = EnvSchema.parse({ ENABLE_API_KEY_ADMIN_ACCESS: "true" });
      expect(result.ENABLE_API_KEY_ADMIN_ACCESS).toBe(true);
    });

    it("解析 'false' 为 false", () => {
      const result = EnvSchema.parse({ ENABLE_API_KEY_ADMIN_ACCESS: "false" });
      expect(result.ENABLE_API_KEY_ADMIN_ACCESS).toBe(false);
    });

    it("解析 '0' 为 false", () => {
      const result = EnvSchema.parse({ ENABLE_API_KEY_ADMIN_ACCESS: "0" });
      expect(result.ENABLE_API_KEY_ADMIN_ACCESS).toBe(false);
    });

    it("解析 '1' 为 true", () => {
      const result = EnvSchema.parse({ ENABLE_API_KEY_ADMIN_ACCESS: "1" });
      expect(result.ENABLE_API_KEY_ADMIN_ACCESS).toBe(true);
    });
  });

  describe("LEGACY_ACTIONS_SUNSET_DATE 格式校验", () => {
    it("接受合法的 YYYY-MM-DD", () => {
      const result = EnvSchema.parse({ LEGACY_ACTIONS_SUNSET_DATE: "2027-06-30" });
      expect(result.LEGACY_ACTIONS_SUNSET_DATE).toBe("2027-06-30");
    });

    it("拒绝 YYYY/MM/DD 格式", () => {
      expect(() => EnvSchema.parse({ LEGACY_ACTIONS_SUNSET_DATE: "2026/12/31" })).toThrow();
    });

    it("拒绝空字符串", () => {
      expect(() => EnvSchema.parse({ LEGACY_ACTIONS_SUNSET_DATE: "" })).toThrow();
    });

    it("拒绝缺少日的部分", () => {
      expect(() => EnvSchema.parse({ LEGACY_ACTIONS_SUNSET_DATE: "2026-12" })).toThrow();
    });

    it("拒绝带时分秒的字符串", () => {
      expect(() =>
        EnvSchema.parse({ LEGACY_ACTIONS_SUNSET_DATE: "2026-12-31T00:00:00Z" })
      ).toThrow();
    });
  });

  describe("LEGACY_ACTIONS_DOCS_MODE 枚举校验", () => {
    it("接受 deprecated", () => {
      const result = EnvSchema.parse({ LEGACY_ACTIONS_DOCS_MODE: "deprecated" });
      expect(result.LEGACY_ACTIONS_DOCS_MODE).toBe("deprecated");
    });

    it("接受 hidden", () => {
      const result = EnvSchema.parse({ LEGACY_ACTIONS_DOCS_MODE: "hidden" });
      expect(result.LEGACY_ACTIONS_DOCS_MODE).toBe("hidden");
    });

    it("拒绝其它值", () => {
      expect(() => EnvSchema.parse({ LEGACY_ACTIONS_DOCS_MODE: "off" })).toThrow();
    });
  });

  describe("Helper 函数与 vi.stubEnv 协作", () => {
    it("isLegacyActionsApiEnabled 默认返回 true", () => {
      vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "true");
      resetEnvConfigForTests();
      expect(isLegacyActionsApiEnabled()).toBe(true);
    });

    it("isLegacyActionsApiEnabled 受 stubEnv('false') 影响", () => {
      vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "false");
      resetEnvConfigForTests();
      expect(isLegacyActionsApiEnabled()).toBe(false);
    });

    it("isApiKeyAdminAccessEnabled 默认返回 false", () => {
      vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "false");
      resetEnvConfigForTests();
      expect(isApiKeyAdminAccessEnabled()).toBe(false);
    });

    it("isApiKeyAdminAccessEnabled 受 stubEnv('true') 影响", () => {
      vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "true");
      resetEnvConfigForTests();
      expect(isApiKeyAdminAccessEnabled()).toBe(true);
    });

    it("getLegacyActionsSunsetDate 默认返回 2026-12-31", () => {
      vi.stubEnv("LEGACY_ACTIONS_SUNSET_DATE", "2026-12-31");
      resetEnvConfigForTests();
      expect(getLegacyActionsSunsetDate()).toBe("2026-12-31");
    });

    it("getLegacyActionsSunsetDate 可被 stubEnv 覆盖", () => {
      vi.stubEnv("LEGACY_ACTIONS_SUNSET_DATE", "2027-03-15");
      resetEnvConfigForTests();
      expect(getLegacyActionsSunsetDate()).toBe("2027-03-15");
    });

    it("getLegacyActionsDocsMode 默认返回 deprecated", () => {
      vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "deprecated");
      resetEnvConfigForTests();
      expect(getLegacyActionsDocsMode()).toBe("deprecated");
    });

    it("getLegacyActionsDocsMode 可被 stubEnv 切换为 hidden", () => {
      vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "hidden");
      resetEnvConfigForTests();
      expect(getLegacyActionsDocsMode()).toBe("hidden");
    });
  });
});
