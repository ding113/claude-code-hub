import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  DEFAULT_PREFIXES,
  buildPricesBaseToml,
  filterLiteLLMPrices,
} from "../../../scripts/convert-litellm-to-toml";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

describe("scripts/convert-litellm-to-toml", () => {
  test("filterLiteLLMPrices: 仅保留指定前缀 + chat 模型，并跳过 sample_spec", () => {
    const input = {
      sample_spec: { mode: "chat" },
      "gpt-4o": { mode: "chat", input_cost_per_token: 0.0000025, litellm_provider: "openai" },
      "gpt-4o-embedding": { mode: "embedding", input_cost_per_token: 0.123 },
      "claude-3-5-sonnet": { mode: "chat", output_cost_per_token: 0.00001 },
      "anthropic.claude-3-5-sonnet": { mode: "chat", output_cost_per_token: 0.00001 },
      "o1-mini": { mode: "chat", input_cost_per_token: 0.000003 },
      "o3-mini": { mode: "completion", input_cost_per_token: 0.000003 },
      "gemini-2.0-flash": {
        mode: "chat",
        supported_modalities: ["text", "image"],
        search_context_cost_per_query: {
          search_context_size_high: 0.01,
          search_context_size_low: 0.001,
        },
      },
      "random-model": { mode: "chat" },
    };

    const result = filterLiteLLMPrices(input, DEFAULT_PREFIXES);

    expect(Object.keys(result).sort()).toEqual([
      "claude-3-5-sonnet",
      "gemini-2.0-flash",
      "gpt-4o",
      "o1-mini",
    ]);
    expect(result).not.toHaveProperty("sample_spec");
    expect(result).not.toHaveProperty("anthropic.claude-3-5-sonnet");
    expect(result).not.toHaveProperty("gpt-4o-embedding");
    expect(result).not.toHaveProperty("o3-mini");
    expect(result).not.toHaveProperty("random-model");
  });

  test("buildPricesBaseToml: 生成包含 metadata.version / metadata.checksum 的 TOML，并保留完整字段", () => {
    const models = {
      "gemini-2.0-flash": {
        mode: "chat",
        supported_modalities: ["text", "image"],
        search_context_cost_per_query: {
          search_context_size_high: 0.01,
          search_context_size_low: 0.001,
        },
      },
      "gpt-4o": {
        mode: "chat",
        input_cost_per_token: 0.0000025,
        output_cost_per_token: 0.00001,
        litellm_provider: "openai",
      },
    };

    const version = "2025.12.25";
    const toml = buildPricesBaseToml({ models, version });

    expect(toml).toContain("[metadata]");
    expect(toml).toContain(`version = "${version}"`);

    // checksum 应为 sha256 hex（64 位），并且由 models 内容决定（与 version 无关）
    const checksumMatch = toml.match(/^[ \\t]*checksum[ \\t]*=[ \\t]*"([a-f0-9]{64})"/m);
    expect(checksumMatch?.[1]).toMatch(/^[a-f0-9]{64}$/);

    const toml2 = buildPricesBaseToml({ models, version: "2099.01.01" });
    const checksumMatch2 = toml2.match(/^[ \\t]*checksum[ \\t]*=[ \\t]*"([a-f0-9]{64})"/m);
    expect(checksumMatch2?.[1]).toBe(checksumMatch?.[1]);

    // 模型名需被正确 quote（避免 '.' 等特殊字符导致 TOML dotted key 误解析）
    expect(toml).toContain('[models."gemini-2.0-flash"]');
    expect(toml).toContain('[models."gpt-4o"]');

    // 数组与嵌套 object 必须完整输出
    expect(toml).toContain('supported_modalities = ["text", "image"]');
    expect(toml).toContain('[models."gemini-2.0-flash".search_context_cost_per_query]');
    expect(toml).toContain("search_context_size_high = 0.01");
    expect(toml).toContain("search_context_size_low = 0.001");

    // 字段完整性：gpt-4o 所有 key 都应出现
    for (const key of Object.keys(models["gpt-4o"])) {
      expect(toml).toMatch(new RegExp(`^${key}\\s*=`, "m"));
    }
  });

  test("真实 LiteLLM 价格表：筛选结果数量应在合理范围内（约 200-300）", async () => {
    const filePath = path.resolve(process.cwd(), "public/seed/litellm-prices.json");
    const raw = await readFile(filePath, "utf8");
    const json = JSON.parse(raw) as Record<string, unknown>;

    const filtered = filterLiteLLMPrices(json, DEFAULT_PREFIXES);
    const count = Object.keys(filtered).length;

    expect(count).toBeGreaterThanOrEqual(150);
    expect(count).toBeLessThanOrEqual(350);

    // checksum 算法：对 models 做稳定排序后 JSON.stringify 再 sha256
    const sorted = Object.fromEntries(
      Object.keys(filtered)
        .sort()
        .map((k) => [k, filtered[k]])
    );
    const expectedChecksum = sha256Hex(JSON.stringify(sorted));
    const toml = buildPricesBaseToml({ models: filtered, version: "2025.12.25" });
    expect(toml).toContain(`checksum = "${expectedChecksum}"`);

    // 典型模型应存在
    expect(toml).toContain('[models."gpt-4o"]');
  });
});
