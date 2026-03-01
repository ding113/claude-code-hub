import { describe, expect, test } from "vitest";

import {
  CreateProviderSchema,
  CreateUserSchema,
  UpdateProviderSchema,
  UpdateUserSchema,
} from "./schemas";

describe("Provider schemas - priority/weight/costMultiplier 规则对齐", () => {
  describe("UpdateProviderSchema", () => {
    test("priority 接受 0 和正整数，拒绝负数", () => {
      expect(UpdateProviderSchema.safeParse({ priority: -100 }).success).toBe(false);
      expect(UpdateProviderSchema.safeParse({ priority: -1 }).success).toBe(false);
      expect(UpdateProviderSchema.safeParse({ priority: 0 }).success).toBe(true);
      expect(UpdateProviderSchema.safeParse({ priority: 123 }).success).toBe(true);
    });

    test("weight 接受 1-100 正整数，拒绝 0 和超出范围的值", () => {
      expect(UpdateProviderSchema.safeParse({ weight: 0 }).success).toBe(false);
      expect(UpdateProviderSchema.safeParse({ weight: 1 }).success).toBe(true);
      expect(UpdateProviderSchema.safeParse({ weight: 100 }).success).toBe(true);
      expect(UpdateProviderSchema.safeParse({ weight: 101 }).success).toBe(false);
      expect(UpdateProviderSchema.safeParse({ weight: -1 }).success).toBe(false);
    });

    test("costMultiplier 接受 0 和正数（含小数），使用 coerce 支持字符串转换", () => {
      expect(UpdateProviderSchema.safeParse({ cost_multiplier: 0 }).success).toBe(true);
      expect(UpdateProviderSchema.safeParse({ cost_multiplier: 0.5 }).success).toBe(true);
      expect(UpdateProviderSchema.safeParse({ cost_multiplier: 1.5 }).success).toBe(true);
      // coerce 会将字符串转为数字
      expect(UpdateProviderSchema.safeParse({ cost_multiplier: "0.5" }).success).toBe(true);
      expect(UpdateProviderSchema.safeParse({ cost_multiplier: "1.5" }).success).toBe(true);
      // 负数被拒绝
      expect(UpdateProviderSchema.safeParse({ cost_multiplier: -1 }).success).toBe(false);
    });

    test("非法值被拒绝", () => {
      // priority: 字符串和 null 被拒绝
      expect(UpdateProviderSchema.safeParse({ priority: "-100" }).success).toBe(false);
      expect(UpdateProviderSchema.safeParse({ priority: "abc" }).success).toBe(false);
      expect(UpdateProviderSchema.safeParse({ priority: null }).success).toBe(false);

      // weight: 字符串和 null 被拒绝
      expect(UpdateProviderSchema.safeParse({ weight: "0" }).success).toBe(false);
      expect(UpdateProviderSchema.safeParse({ weight: null }).success).toBe(false);

      // cost_multiplier: 非数字字符串被拒绝
      expect(UpdateProviderSchema.safeParse({ cost_multiplier: "abc" }).success).toBe(false);
      // 注意: null 会被 coerce 转为 0 (Number(null) === 0)，所以会通过
    });
  });

  describe("CreateProviderSchema", () => {
    const base = {
      name: "测试供应商",
      url: "https://api.example.com",
      key: "sk-test",
    };

    test("priority 接受 0 和正整数，拒绝负数", () => {
      expect(CreateProviderSchema.safeParse({ ...base, priority: -100 }).success).toBe(false);
      expect(CreateProviderSchema.safeParse({ ...base, priority: -1 }).success).toBe(false);
      expect(CreateProviderSchema.safeParse({ ...base, priority: 0 }).success).toBe(true);
      expect(CreateProviderSchema.safeParse({ ...base, priority: 123 }).success).toBe(true);
    });

    test("weight 接受 1-100 正整数，拒绝 0 和超出范围的值", () => {
      expect(CreateProviderSchema.safeParse({ ...base, weight: 0 }).success).toBe(false);
      expect(CreateProviderSchema.safeParse({ ...base, weight: 1 }).success).toBe(true);
      expect(CreateProviderSchema.safeParse({ ...base, weight: 100 }).success).toBe(true);
      expect(CreateProviderSchema.safeParse({ ...base, weight: 101 }).success).toBe(false);
      expect(CreateProviderSchema.safeParse({ ...base, weight: -1 }).success).toBe(false);
    });

    test("costMultiplier 接受 0 和正数（含小数），使用 coerce 支持字符串转换", () => {
      expect(CreateProviderSchema.safeParse({ ...base, cost_multiplier: 0 }).success).toBe(true);
      expect(CreateProviderSchema.safeParse({ ...base, cost_multiplier: 0.5 }).success).toBe(true);
      expect(CreateProviderSchema.safeParse({ ...base, cost_multiplier: 1.5 }).success).toBe(true);
      // coerce 会将字符串转为数字
      expect(CreateProviderSchema.safeParse({ ...base, cost_multiplier: "0.5" }).success).toBe(
        true
      );
      expect(CreateProviderSchema.safeParse({ ...base, cost_multiplier: "1.5" }).success).toBe(
        true
      );
      // 负数被拒绝
      expect(CreateProviderSchema.safeParse({ ...base, cost_multiplier: -1 }).success).toBe(false);
    });

    test("非法值被拒绝", () => {
      // priority: 字符串和 null 被拒绝
      expect(CreateProviderSchema.safeParse({ ...base, priority: "-100" }).success).toBe(false);
      expect(CreateProviderSchema.safeParse({ ...base, priority: "abc" }).success).toBe(false);
      expect(CreateProviderSchema.safeParse({ ...base, priority: null }).success).toBe(false);

      // weight: 字符串和 null 被拒绝
      expect(CreateProviderSchema.safeParse({ ...base, weight: "0" }).success).toBe(false);
      expect(CreateProviderSchema.safeParse({ ...base, weight: null }).success).toBe(false);

      // cost_multiplier: 非数字字符串被拒绝
      expect(CreateProviderSchema.safeParse({ ...base, cost_multiplier: "abc" }).success).toBe(
        false
      );
      // 注意: null 会被 coerce 转为 0 (Number(null) === 0)，所以会通过
    });

    test("allowed_clients/blocked_clients 支持 null 并归一化为空数组", () => {
      const base = {
        name: "测试供应商",
        url: "https://api.example.com",
        key: "sk-test",
      };

      const parsed = CreateProviderSchema.parse({
        ...base,
        allowed_clients: null,
        blocked_clients: null,
      });

      expect(parsed.allowed_clients).toEqual([]);
      expect(parsed.blocked_clients).toEqual([]);
    });
  });

  describe("client restrictions null normalization", () => {
    test("UpdateProviderSchema 将 null 归一化为空数组", () => {
      const parsed = UpdateProviderSchema.parse({
        allowed_clients: null,
        blocked_clients: null,
      });

      expect(parsed.allowed_clients).toEqual([]);
      expect(parsed.blocked_clients).toEqual([]);
    });

    test("CreateUserSchema 将 null 归一化为空数组", () => {
      const parsed = CreateUserSchema.parse({
        name: "test-user",
        allowedClients: null,
        blockedClients: null,
      });

      expect(parsed.allowedClients).toEqual([]);
      expect(parsed.blockedClients).toEqual([]);
    });

    test("UpdateUserSchema 将 null 归一化为空数组", () => {
      const parsed = UpdateUserSchema.parse({
        allowedClients: null,
        blockedClients: null,
      });

      expect(parsed.allowedClients).toEqual([]);
      expect(parsed.blockedClients).toEqual([]);
    });
  });
});
