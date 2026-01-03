import { describe, expect, test } from "vitest";
import {
  formatAnthropicResponse,
  formatGeminiResponse,
  formatOpenAIResponse,
  getProviderTypesForFormat,
  inferOwner,
  type FetchedModel,
} from "@/app/v1/_lib/models/available-models";

describe("inferOwner - 根据模型 ID 推断所有者", () => {
  describe("Anthropic 模型", () => {
    test("claude-* 模型应返回 anthropic", () => {
      expect(inferOwner("claude-3-opus-20240229")).toBe("anthropic");
      expect(inferOwner("claude-3-sonnet-20240229")).toBe("anthropic");
      expect(inferOwner("claude-3-haiku-20240307")).toBe("anthropic");
      expect(inferOwner("claude-2.1")).toBe("anthropic");
      expect(inferOwner("claude-instant-1.2")).toBe("anthropic");
    });
  });

  describe("OpenAI 模型", () => {
    test("gpt-* 模型应返回 openai", () => {
      expect(inferOwner("gpt-4")).toBe("openai");
      expect(inferOwner("gpt-4-turbo")).toBe("openai");
      expect(inferOwner("gpt-3.5-turbo")).toBe("openai");
      expect(inferOwner("gpt-4o")).toBe("openai");
    });

    test("o1* 模型应返回 openai", () => {
      expect(inferOwner("o1-preview")).toBe("openai");
      expect(inferOwner("o1-mini")).toBe("openai");
      expect(inferOwner("o1")).toBe("openai");
    });

    test("o3* 模型应返回 openai", () => {
      expect(inferOwner("o3-mini")).toBe("openai");
      expect(inferOwner("o3")).toBe("openai");
    });
  });

  describe("Google 模型", () => {
    test("gemini-* 模型应返回 google", () => {
      expect(inferOwner("gemini-pro")).toBe("google");
      expect(inferOwner("gemini-1.5-pro")).toBe("google");
      expect(inferOwner("gemini-1.5-flash")).toBe("google");
      expect(inferOwner("gemini-2.0-flash-exp")).toBe("google");
    });
  });

  describe("DeepSeek 模型", () => {
    test("deepseek* 模型应返回 deepseek", () => {
      expect(inferOwner("deepseek-chat")).toBe("deepseek");
      expect(inferOwner("deepseek-coder")).toBe("deepseek");
      expect(inferOwner("deepseek-v3")).toBe("deepseek");
    });
  });

  describe("Alibaba 模型", () => {
    test("qwen* 模型应返回 alibaba", () => {
      expect(inferOwner("qwen-turbo")).toBe("alibaba");
      expect(inferOwner("qwen-plus")).toBe("alibaba");
      expect(inferOwner("qwen-max")).toBe("alibaba");
    });
  });

  describe("未知模型", () => {
    test("无法识别的模型应返回 unknown", () => {
      expect(inferOwner("llama-2-70b")).toBe("unknown");
      expect(inferOwner("mistral-7b")).toBe("unknown");
      expect(inferOwner("custom-model")).toBe("unknown");
    });
  });
});

describe("getProviderTypesForFormat - 客户端格式到 Provider 类型映射", () => {
  test("claude 格式应返回 claude 和 claude-auth 类型", () => {
    expect(getProviderTypesForFormat("claude")).toEqual(["claude", "claude-auth"]);
  });

  test("openai 格式应返回 codex 和 openai-compatible 类型", () => {
    expect(getProviderTypesForFormat("openai")).toEqual(["codex", "openai-compatible"]);
  });

  test("gemini 格式应返回 gemini 和 gemini-cli 类型", () => {
    expect(getProviderTypesForFormat("gemini")).toEqual(["gemini", "gemini-cli"]);
  });

  test("gemini-cli 格式应返回 gemini 和 gemini-cli 类型", () => {
    expect(getProviderTypesForFormat("gemini-cli")).toEqual(["gemini", "gemini-cli"]);
  });

  test("response 格式应仅返回 codex 类型", () => {
    expect(getProviderTypesForFormat("response")).toEqual(["codex"]);
  });
});

describe("formatOpenAIResponse - OpenAI 格式响应", () => {
  test("空模型列表应返回空 data 数组", () => {
    const result = formatOpenAIResponse([]) as { object: string; data: unknown[] };
    expect(result.object).toBe("list");
    expect(result.data).toEqual([]);
  });

  test("应正确格式化模型列表", () => {
    const models: FetchedModel[] = [
      { id: "gpt-4" },
      { id: "claude-3-opus-20240229" },
      { id: "gemini-pro" },
    ];

    const result = formatOpenAIResponse(models) as {
      object: string;
      data: Array<{ id: string; object: string; created: number; owned_by: string }>;
    };

    expect(result.object).toBe("list");
    expect(result.data).toHaveLength(3);

    expect(result.data[0].id).toBe("gpt-4");
    expect(result.data[0].object).toBe("model");
    expect(result.data[0].owned_by).toBe("openai");
    expect(typeof result.data[0].created).toBe("number");

    expect(result.data[1].id).toBe("claude-3-opus-20240229");
    expect(result.data[1].owned_by).toBe("anthropic");

    expect(result.data[2].id).toBe("gemini-pro");
    expect(result.data[2].owned_by).toBe("google");
  });

  test("created 时间戳应为当前时间（秒）", () => {
    const before = Math.floor(Date.now() / 1000);
    const result = formatOpenAIResponse([{ id: "test" }]) as {
      data: Array<{ created: number }>;
    };
    const after = Math.floor(Date.now() / 1000);

    expect(result.data[0].created).toBeGreaterThanOrEqual(before);
    expect(result.data[0].created).toBeLessThanOrEqual(after);
  });
});

describe("formatAnthropicResponse - Anthropic 格式响应", () => {
  test("空模型列表应返回空 data 数组", () => {
    const result = formatAnthropicResponse([]) as { data: unknown[]; has_more: boolean };
    expect(result.data).toEqual([]);
    expect(result.has_more).toBe(false);
  });

  test("应正确格式化模型列表", () => {
    const models: FetchedModel[] = [
      { id: "claude-3-opus-20240229", displayName: "Claude 3 Opus", createdAt: "2024-02-29T00:00:00Z" },
      { id: "claude-3-sonnet-20240229" },
    ];

    const result = formatAnthropicResponse(models) as {
      data: Array<{ id: string; type: string; display_name: string; created_at: string }>;
      has_more: boolean;
    };

    expect(result.has_more).toBe(false);
    expect(result.data).toHaveLength(2);

    expect(result.data[0].id).toBe("claude-3-opus-20240229");
    expect(result.data[0].type).toBe("model");
    expect(result.data[0].display_name).toBe("Claude 3 Opus");
    expect(result.data[0].created_at).toBe("2024-02-29T00:00:00Z");

    expect(result.data[1].id).toBe("claude-3-sonnet-20240229");
    expect(result.data[1].display_name).toBe("claude-3-sonnet-20240229");
    expect(result.data[1].created_at).toBeDefined();
  });

  test("缺少 displayName 时应使用 id 作为 display_name", () => {
    const result = formatAnthropicResponse([{ id: "test-model" }]) as {
      data: Array<{ display_name: string }>;
    };
    expect(result.data[0].display_name).toBe("test-model");
  });
});

describe("formatGeminiResponse - Gemini 格式响应", () => {
  test("空模型列表应返回空 models 数组", () => {
    const result = formatGeminiResponse([]) as { models: unknown[] };
    expect(result.models).toEqual([]);
  });

  test("应正确格式化模型列表", () => {
    const models: FetchedModel[] = [
      { id: "gemini-pro", displayName: "Gemini Pro" },
      { id: "gemini-1.5-flash" },
    ];

    const result = formatGeminiResponse(models) as {
      models: Array<{
        name: string;
        displayName: string;
        supportedGenerationMethods: string[];
      }>;
    };

    expect(result.models).toHaveLength(2);

    expect(result.models[0].name).toBe("models/gemini-pro");
    expect(result.models[0].displayName).toBe("Gemini Pro");
    expect(result.models[0].supportedGenerationMethods).toEqual(["generateContent"]);

    expect(result.models[1].name).toBe("models/gemini-1.5-flash");
    expect(result.models[1].displayName).toBe("gemini-1.5-flash");
  });

  test("模型名称应添加 models/ 前缀", () => {
    const result = formatGeminiResponse([{ id: "test-model" }]) as {
      models: Array<{ name: string }>;
    };
    expect(result.models[0].name).toBe("models/test-model");
  });

  test("缺少 displayName 时应使用 id", () => {
    const result = formatGeminiResponse([{ id: "test-model" }]) as {
      models: Array<{ displayName: string }>;
    };
    expect(result.models[0].displayName).toBe("test-model");
  });
});
