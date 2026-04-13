import { describe, expect, it } from "vitest";
import type { ProviderDisplay } from "@/types/provider";
import { analyzeBatchProviderSettings } from "@/app/[locale]/settings/providers/_components/batch-edit/analyze-batch-settings";

describe("analyzeBatchProviderSettings", () => {
  describe("空列表", () => {
    it("应该返回所有字段为 empty 状态", () => {
      const result = analyzeBatchProviderSettings([]);

      expect(result.routing.priority.status).toBe("empty");
      expect(result.routing.weight.status).toBe("empty");
      expect(result.rateLimit.limit5hUsd.status).toBe("empty");
    });
  });

  describe("uniform 值", () => {
    it("应该识别所有供应商有相同的基本类型值", () => {
      const providers: ProviderDisplay[] = [
        {
          priority: 10,
          weight: 5,
          costMultiplier: 1.5,
          disableSessionReuse: true,
        } as ProviderDisplay,
        {
          priority: 10,
          weight: 5,
          costMultiplier: 1.5,
          disableSessionReuse: true,
        } as ProviderDisplay,
        {
          priority: 10,
          weight: 5,
          costMultiplier: 1.5,
          disableSessionReuse: true,
        } as ProviderDisplay,
      ];

      const result = analyzeBatchProviderSettings(providers);

      expect(result.routing.priority).toEqual({ status: "uniform", value: 10 });
      expect(result.routing.weight).toEqual({ status: "uniform", value: 5 });
      expect(result.routing.costMultiplier).toEqual({ status: "uniform", value: 1.5 });
      expect(result.routing.disableSessionReuse).toEqual({ status: "uniform", value: true });
    });

    it("应该识别所有供应商有相同的对象值", () => {
      const providers: ProviderDisplay[] = [
        {
          modelRedirects: [{ matchType: "exact", source: "model-a", target: "model-b" }],
        } as ProviderDisplay,
        {
          modelRedirects: [{ matchType: "exact", source: "model-a", target: "model-b" }],
        } as ProviderDisplay,
      ];

      const result = analyzeBatchProviderSettings(providers);

      expect(result.routing.modelRedirects).toEqual({
        status: "uniform",
        value: [{ matchType: "exact", source: "model-a", target: "model-b" }],
      });
    });

    it("应该识别所有供应商有相同的数组值", () => {
      const providers: ProviderDisplay[] = [
        { allowedModels: ["model-1", "model-2"] } as ProviderDisplay,
        { allowedModels: ["model-1", "model-2"] } as ProviderDisplay,
      ];

      const result = analyzeBatchProviderSettings(providers);

      expect(result.routing.allowedModels).toEqual({
        status: "uniform",
        value: [
          { matchType: "exact", pattern: "model-1" },
          { matchType: "exact", pattern: "model-2" },
        ],
      });
    });

    it("应该识别所有供应商都为 null 的字段", () => {
      const providers: ProviderDisplay[] = [
        { limit5hUsd: null } as ProviderDisplay,
        { limit5hUsd: null } as ProviderDisplay,
      ];

      const result = analyzeBatchProviderSettings(providers);

      expect(result.rateLimit.limit5hUsd.status).toBe("empty");
    });
  });

  describe("mixed 值", () => {
    it("应该识别供应商有不同的基本类型值", () => {
      const providers: ProviderDisplay[] = [
        { priority: 10, disableSessionReuse: false } as ProviderDisplay,
        { priority: 20, disableSessionReuse: true } as ProviderDisplay,
        { priority: 30, disableSessionReuse: false } as ProviderDisplay,
      ];

      const result = analyzeBatchProviderSettings(providers);

      expect(result.routing.priority.status).toBe("mixed");
      if (result.routing.priority.status === "mixed") {
        expect(result.routing.priority.values).toEqual([10, 20, 30]);
      }
      expect(result.routing.disableSessionReuse.status).toBe("mixed");
      if (result.routing.disableSessionReuse.status === "mixed") {
        expect(result.routing.disableSessionReuse.values).toEqual([false, true]);
      }
    });

    it("应该识别供应商有不同的对象值", () => {
      const providers: ProviderDisplay[] = [
        {
          modelRedirects: [{ matchType: "exact", source: "model-a", target: "model-b" }],
        } as ProviderDisplay,
        {
          modelRedirects: [{ matchType: "exact", source: "model-c", target: "model-d" }],
        } as ProviderDisplay,
      ];

      const result = analyzeBatchProviderSettings(providers);

      expect(result.routing.modelRedirects.status).toBe("mixed");
      if (result.routing.modelRedirects.status === "mixed") {
        expect(result.routing.modelRedirects.values).toEqual([
          [{ matchType: "exact", source: "model-a", target: "model-b" }],
          [{ matchType: "exact", source: "model-c", target: "model-d" }],
        ]);
      }
    });

    it("应该去重 mixed 值", () => {
      const providers: ProviderDisplay[] = [
        { priority: 10 } as ProviderDisplay,
        { priority: 20 } as ProviderDisplay,
        { priority: 10 } as ProviderDisplay, // 重复
        { priority: 20 } as ProviderDisplay, // 重复
      ];

      const result = analyzeBatchProviderSettings(providers);

      expect(result.routing.priority.status).toBe("mixed");
      if (result.routing.priority.status === "mixed") {
        expect(result.routing.priority.values).toEqual([10, 20]);
      }
    });
  });

  describe("复杂字段", () => {
    it("应该正确处理 groupTag 字段（字符串转数组）", () => {
      const providers: ProviderDisplay[] = [
        { groupTag: "tag1, tag2" } as ProviderDisplay,
        { groupTag: "tag1, tag2" } as ProviderDisplay,
      ];

      const result = analyzeBatchProviderSettings(providers);

      expect(result.routing.groupTag).toEqual({
        status: "uniform",
        value: ["tag1", "tag2"],
      });
    });

    it("应该正确处理空 groupTag", () => {
      const providers: ProviderDisplay[] = [
        { groupTag: null } as ProviderDisplay,
        { groupTag: "" } as ProviderDisplay,
      ];

      const result = analyzeBatchProviderSettings(providers);

      expect(result.routing.groupTag).toEqual({
        status: "uniform",
        value: [],
      });
    });

    it("应该正确处理 circuitBreaker 时间单位转换（ms -> minutes）", () => {
      const providers: ProviderDisplay[] = [
        { circuitBreakerOpenDuration: 300000 } as ProviderDisplay, // 5 分钟
        { circuitBreakerOpenDuration: 300000 } as ProviderDisplay,
      ];

      const result = analyzeBatchProviderSettings(providers);

      expect(result.circuitBreaker.openDurationMinutes).toEqual({
        status: "uniform",
        value: 5,
      });
    });

    it("应该正确处理 network 时间单位转换（ms -> seconds）", () => {
      const providers: ProviderDisplay[] = [
        { firstByteTimeoutStreamingMs: 30000 } as ProviderDisplay, // 30 秒
        { firstByteTimeoutStreamingMs: 30000 } as ProviderDisplay,
      ];

      const result = analyzeBatchProviderSettings(providers);

      expect(result.network.firstByteTimeoutStreamingSeconds).toEqual({
        status: "uniform",
        value: 30,
      });
    });

    it("应该正确处理 anthropicAdaptiveThinking 复杂对象", () => {
      const config = {
        effort: "high" as const,
        modelMatchMode: "specific" as const,
        models: ["claude-opus-4-6"],
      };

      const providers: ProviderDisplay[] = [
        { anthropicAdaptiveThinking: config } as ProviderDisplay,
        { anthropicAdaptiveThinking: config } as ProviderDisplay,
      ];

      const result = analyzeBatchProviderSettings(providers);

      expect(result.routing.anthropicAdaptiveThinking).toEqual({
        status: "uniform",
        value: config,
      });
    });
  });

  describe("默认值处理", () => {
    it("应该为未设置的字段使用默认值", () => {
      const providers: ProviderDisplay[] = [
        {
          preserveClientIp: false,
          cacheTtlPreference: "inherit",
          dailyResetMode: "fixed",
        } as ProviderDisplay,
        {
          preserveClientIp: false,
          cacheTtlPreference: "inherit",
          dailyResetMode: "fixed",
        } as ProviderDisplay,
      ];

      const result = analyzeBatchProviderSettings(providers);

      // 检查一些有默认值的字段
      expect(result.routing.cacheTtlPreference).toEqual({
        status: "uniform",
        value: "inherit",
      });
      expect(result.routing.preserveClientIp).toEqual({
        status: "uniform",
        value: false,
      });
      expect(result.rateLimit.dailyResetMode).toEqual({
        status: "uniform",
        value: "fixed",
      });
    });
  });
});
