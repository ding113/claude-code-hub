import { describe, expect, it } from "vitest";
import type { ProviderDisplay } from "@/types/provider";
import { createInitialState } from "@/app/[locale]/settings/providers/_components/forms/provider-form/provider-form-context";

describe("批量编辑预填充集成测试", () => {
  it("应该在批量模式下预填充相同的设置值", () => {
    const providers: ProviderDisplay[] = [
      {
        id: 1,
        name: "Provider A",
        priority: 10,
        weight: 5,
        costMultiplier: 1.5,
        modelRedirects: [{ matchType: "exact", source: "model-a", target: "model-b" }],
        allowedModels: ["model-1", "model-2"],
        limit5hUsd: 100,
        circuitBreakerFailureThreshold: 5,
        circuitBreakerOpenDuration: 300000, // 5 minutes
      } as ProviderDisplay,
      {
        id: 2,
        name: "Provider B",
        priority: 10,
        weight: 5,
        costMultiplier: 1.5,
        modelRedirects: [{ matchType: "exact", source: "model-a", target: "model-b" }],
        allowedModels: ["model-1", "model-2"],
        limit5hUsd: 100,
        circuitBreakerFailureThreshold: 5,
        circuitBreakerOpenDuration: 300000,
      } as ProviderDisplay,
    ];

    const state = createInitialState("batch", undefined, undefined, undefined, providers);

    // 验证预填充的值
    expect(state.routing.priority).toBe(10);
    expect(state.routing.weight).toBe(5);
    expect(state.routing.costMultiplier).toBe(1.5);
    expect(state.routing.modelRedirects).toEqual([
      { matchType: "exact", source: "model-a", target: "model-b" },
    ]);
    expect(state.routing.allowedModels).toEqual(["model-1", "model-2"]);
    expect(state.rateLimit.limit5hUsd).toBe(100);
    expect(state.circuitBreaker.failureThreshold).toBe(5);
    expect(state.circuitBreaker.openDurationMinutes).toBe(5);
  });

  it("应该在批量模式下对不同的设置值使用默认值", () => {
    const providers: ProviderDisplay[] = [
      {
        id: 1,
        name: "Provider A",
        priority: 10,
        weight: 5,
      } as ProviderDisplay,
      {
        id: 2,
        name: "Provider B",
        priority: 20, // 不同的值
        weight: 10, // 不同的值
      } as ProviderDisplay,
    ];

    const state = createInitialState("batch", undefined, undefined, undefined, providers);

    // 验证使用默认值
    expect(state.routing.priority).toBe(0); // 默认值
    expect(state.routing.weight).toBe(1); // 默认值
  });

  it("应该在没有 batchProviders 时使用默认值", () => {
    const state = createInitialState("batch");

    // 验证所有字段都是默认值
    expect(state.routing.priority).toBe(0);
    expect(state.routing.weight).toBe(1);
    expect(state.routing.costMultiplier).toBe(1.0);
    expect(state.routing.modelRedirects).toEqual([]);
    expect(state.routing.allowedModels).toEqual([]);
    expect(state.rateLimit.limit5hUsd).toBeNull();
    expect(state.circuitBreaker.failureThreshold).toBeUndefined();
  });
});
