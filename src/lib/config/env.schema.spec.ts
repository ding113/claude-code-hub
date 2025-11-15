import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EnvSchema } from "./env.schema";

describe("EnvSchema", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("布尔值转换", () => {
    it('should convert string "false" to boolean false', () => {
      process.env.AUTO_MIGRATE = "false";
      const config = EnvSchema.parse(process.env);
      expect(config.AUTO_MIGRATE).toBe(false);
    });

    it('should convert string "0" to boolean false', () => {
      process.env.AUTO_MIGRATE = "0";
      const config = EnvSchema.parse(process.env);
      expect(config.AUTO_MIGRATE).toBe(false);
    });

    it('should convert string "true" to boolean true', () => {
      process.env.AUTO_MIGRATE = "true";
      const config = EnvSchema.parse(process.env);
      expect(config.AUTO_MIGRATE).toBe(true);
    });

    it('should convert string "1" to boolean true', () => {
      process.env.AUTO_MIGRATE = "1";
      const config = EnvSchema.parse(process.env);
      expect(config.AUTO_MIGRATE).toBe(true);
    });

    it("should default ENABLE_RATE_LIMIT to true", () => {
      delete process.env.ENABLE_RATE_LIMIT;
      const config = EnvSchema.parse(process.env);
      expect(config.ENABLE_RATE_LIMIT).toBe(true);
    });

    it("should handle ENABLE_SECURE_COOKIES false correctly", () => {
      process.env.ENABLE_SECURE_COOKIES = "false";
      const config = EnvSchema.parse(process.env);
      expect(config.ENABLE_SECURE_COOKIES).toBe(false);
    });
  });

  describe("默认值", () => {
    it("should use default values when env vars are not set", () => {
      const config = EnvSchema.parse({});
      expect(config.NODE_ENV).toBe("development");
      expect(config.PORT).toBe(23000);
      expect(config.TZ).toBe("Asia/Shanghai");
      expect(config.LOG_LEVEL).toBe("info");
      expect(config.SESSION_TTL).toBe(300);
    });

    it("should default DEBUG_MODE to false", () => {
      const config = EnvSchema.parse({});
      expect(config.DEBUG_MODE).toBe(false);
    });

    it("should default ENABLE_MULTI_PROVIDER_TYPES to false", () => {
      const config = EnvSchema.parse({});
      expect(config.ENABLE_MULTI_PROVIDER_TYPES).toBe(false);
    });
  });

  describe("数字转换", () => {
    it("should convert string PORT to number", () => {
      process.env.PORT = "3000";
      const config = EnvSchema.parse(process.env);
      expect(config.PORT).toBe(3000);
      expect(typeof config.PORT).toBe("number");
    });

    it("should convert SESSION_TTL to number", () => {
      process.env.SESSION_TTL = "600";
      const config = EnvSchema.parse(process.env);
      expect(config.SESSION_TTL).toBe(600);
      expect(typeof config.SESSION_TTL).toBe("number");
    });

    it("should handle FETCH_BODY_TIMEOUT default", () => {
      const config = EnvSchema.parse({});
      expect(config.FETCH_BODY_TIMEOUT).toBe(120000);
    });
  });

  describe("可选字段", () => {
    it("should handle optional DSN", () => {
      delete process.env.DSN;
      const config = EnvSchema.parse(process.env);
      expect(config.DSN).toBeUndefined();
    });

    it("should handle valid DSN URL", () => {
      process.env.DSN = "postgres://user:pass@localhost:5432/db";
      const config = EnvSchema.parse(process.env);
      expect(config.DSN).toBe("postgres://user:pass@localhost:5432/db");
    });

    it("should filter out placeholder DSN", () => {
      process.env.DSN = "postgres://user:password@host:port/database";
      const config = EnvSchema.parse(process.env);
      expect(config.DSN).toBeUndefined();
    });

    it("should filter out change-me ADMIN_TOKEN", () => {
      process.env.ADMIN_TOKEN = "change-me";
      const config = EnvSchema.parse(process.env);
      expect(config.ADMIN_TOKEN).toBeUndefined();
    });

    it("should handle optional REDIS_URL", () => {
      delete process.env.REDIS_URL;
      const config = EnvSchema.parse(process.env);
      expect(config.REDIS_URL).toBeUndefined();
    });
  });

  describe("枚举验证", () => {
    it("should accept valid NODE_ENV values", () => {
      const parseWithEnv = (value: "development" | "production" | "test") => {
        const env = { ...process.env, NODE_ENV: value } as NodeJS.ProcessEnv;
        return EnvSchema.parse(env).NODE_ENV;
      };

      expect(parseWithEnv("production")).toBe("production");
      expect(parseWithEnv("development")).toBe("development");
      expect(parseWithEnv("test")).toBe("test");
    });

    it("should accept valid LOG_LEVEL values", () => {
      process.env.LOG_LEVEL = "debug";
      let config = EnvSchema.parse(process.env);
      expect(config.LOG_LEVEL).toBe("debug");

      process.env.LOG_LEVEL = "error";
      config = EnvSchema.parse(process.env);
      expect(config.LOG_LEVEL).toBe("error");
    });
  });
});
