import { describe, expect, it } from "vitest";
import {
  CODEX_MODEL_CATALOG_MAX_BYTES,
  CODEX_MODEL_CATALOG_UPSTREAM_MAX_BYTES,
  type CodexModelInfo,
  mergeCodexModelCatalog,
  parseCodexModelCatalog,
  projectCodexModelCatalog,
} from "@/lib/codex-model-catalog";
import type { Provider } from "@/types/provider";

function nativeModel(overrides: Record<string, unknown> = {}): CodexModelInfo {
  return {
    slug: "gpt-6.1-sol",
    display_name: "GPT-6.1-Sol",
    supported_reasoning_levels: [{ effort: "low", description: "Low" }],
    shell_type: "shell_command",
    visibility: "list",
    supported_in_api: true,
    priority: 0,
    support_verbosity: false,
    truncation_policy: { mode: "tokens", limit: 10000 },
    experimental_supported_tools: [],
    base_instructions: "You are a coding agent.",
    context_window: 500000,
    max_context_window: 872000,
    ...overrides,
  };
}

function provider(
  overrides: Partial<Pick<Provider, "allowedModels" | "modelRedirects">> = {}
): Pick<Provider, "allowedModels" | "modelRedirects"> {
  return { allowedModels: null, modelRedirects: null, ...overrides };
}

describe("parseCodexModelCatalog", () => {
  it("retains complete native metadata and distinct default and maximum windows", () => {
    const model = nativeModel({ future_metadata: { tools: ["future_tool"] }, max_tokens: 0 });
    const [parsed] = parseCodexModelCatalog({ models: [model] });
    expect(parsed).toEqual(model);
    expect(parsed).not.toBe(model);
    expect(parsed.future_metadata).not.toBe(model.future_metadata);
    expect(CODEX_MODEL_CATALOG_MAX_BYTES).toBe(1048576);
    expect(CODEX_MODEL_CATALOG_UPSTREAM_MAX_BYTES).toBe(4194304);
  });

  it.each([null, [], "invalid", {}, { models: null }, { models: {} }, { data: [{ id: "gpt" }] }])(
    "ignores an invalid or ordinary OpenAI envelope: %j",
    (body) => expect(parseCodexModelCatalog(body)).toEqual([])
  );

  it("supports canonical instructions, absent windows, null options and future effort names", () => {
    const model = nativeModel({
      base_instructions: undefined,
      model_messages: { instructions_template: "Canonical instructions", future_option: true },
      context_window: undefined,
      max_context_window: null,
      auto_compact_token_limit: null,
      description: null,
      default_reasoning_level: "future-effort",
      supported_reasoning_levels: [{ effort: "future-effort", description: "Future effort" }],
      effective_context_window_percent: 95,
      priority: -1,
      shell_type: "unified_exec",
      truncation_policy: { mode: "bytes", limit: 20000 },
    });
    expect(parseCodexModelCatalog({ models: [model] })).toEqual([model]);
  });

  it("accepts nonreasoning models and optional legacy fields", () => {
    const model = nativeModel({
      supported_reasoning_levels: [],
      default_reasoning_level: null,
      model_messages: null,
      context_window: null,
      max_context_window: null,
      base_instructions: "",
      effective_context_window_percent: 100,
    });
    expect(parseCodexModelCatalog({ models: [model] })).toEqual([model]);
  });

  it.each([
    ["slug", " "],
    ["display_name", 1],
    ["shell_type", "unsupported"],
    ["visibility", "visible"],
    ["supported_in_api", "true"],
    ["support_verbosity", 1],
    ["priority", "0"],
    ["priority", 0.5],
    ["priority", -2147483649],
    ["priority", 2147483648],
    ["experimental_supported_tools", "tools"],
    ["experimental_supported_tools", [42]],
    ["truncation_policy", null],
    ["truncation_policy", { mode: "unknown", limit: 10000 }],
    ["truncation_policy", { mode: "tokens", limit: -1 }],
    ["supported_reasoning_levels", {}],
    ["supported_reasoning_levels", [null]],
    ["supported_reasoning_levels", [{ effort: "", description: "Invalid" }]],
    ["supported_reasoning_levels", [{ effort: "low", description: 1 }]],
    ["context_window", 0],
    ["context_window", 1.5],
    ["context_window", Number.NaN],
    ["context_window", Number.POSITIVE_INFINITY],
    ["context_window", Number.MAX_SAFE_INTEGER + 1],
    ["max_context_window", "1000000"],
    ["auto_compact_token_limit", -1],
    ["effective_context_window_percent", null],
    ["effective_context_window_percent", 0],
    ["effective_context_window_percent", 101],
    ["effective_context_window_percent", 50.5],
    ["description", {}],
    ["default_reasoning_level", 2],
    ["base_instructions", false],
    ["base_instructions", undefined],
    ["model_messages", []],
    ["model_messages", { instructions_template: 42 }],
    ["max_context_window", 400000],
    ["supports_search_tool", "yes"],
    ["include_apps_usage_instructions", null],
    ["default_reasoning_summary", null],
    ["default_reasoning_summary", "unsupported"],
    ["default_verbosity", "unsupported"],
    ["apply_patch_tool_type", "unsupported"],
    ["web_search_tool_type", "unsupported"],
    ["additional_speed_tiers", null],
    ["additional_speed_tiers", [42]],
    ["input_modalities", 123],
    ["input_modalities", ["video"]],
    ["service_tiers", null],
    ["service_tiers", [null]],
    ["service_tiers", [{ id: "fast", name: 1, description: "Fast" }]],
    ["service_tiers", [{ id: "fast", name: "Fast", description: 1 }]],
    ["guardian", true],
    ["available_access_programs", { cyber: 1 }],
    ["availability_nux", {}],
    ["upgrade", { model: "future", migration_markdown: 1 }],
    ["upgrade", { model: 1, migration_markdown: "Migration" }],
    ["model_messages", { persistent_instructions: 1 }],
    ["model_messages", { approvals: false }],
  ])("filters an invalid %s value %j without dropping valid siblings", (field, invalid) => {
    const valid = nativeModel();
    expect(
      parseCodexModelCatalog({ models: [null, [], nativeModel({ [field]: invalid }), valid] })
    ).toEqual([valid]);
  });

  it("retains typed optional capabilities, selectors and service metadata", () => {
    const model = nativeModel({
      default_reasoning_summary: "none",
      default_verbosity: null,
      apply_patch_tool_type: null,
      web_search_tool_type: "text_and_image",
      supports_search_tool: true,
      additional_speed_tiers: ["fast"],
      input_modalities: ["text", "image", "audio"],
      service_tiers: [{ id: "fast", name: "Fast", description: "Fast service" }],
      guardian: null,
      available_access_programs: { cyber: ["future-program"] },
      availability_nux: { message: "Available" },
      upgrade: { model: "future-model", migration_markdown: "Migration instructions" },
      tool_mode: "future-tool-mode",
      multi_agent_version: "future-version",
      model_messages: {
        instructions_template: "Canonical instructions",
        content_filter_guidance: null,
        persistent_instructions: "Persistent instructions",
        approvals: {},
        permissions: null,
        future_field: ["preserved"],
      },
    });
    expect(parseCodexModelCatalog({ models: [model] })).toEqual([model]);
  });

  it("requires actual instructions rather than just a model_messages object", () => {
    expect(
      parseCodexModelCatalog({
        models: [nativeModel({ base_instructions: null, model_messages: {} })],
      })
    ).toEqual([]);
  });
});

describe("projectCodexModelCatalog", () => {
  it("preserves native metadata without changing source entries", () => {
    const models = [nativeModel()];
    const projected = projectCodexModelCatalog(models, provider());
    expect(projected).toEqual(models);
    expect(projected[0]).not.toBe(models[0]);
    expect(projected[0].truncation_policy).not.toBe(models[0].truncation_policy);
  });

  it("projects exact allowlist aliases through upstream redirects", () => {
    const model = nativeModel();
    expect(
      projectCodexModelCatalog(
        [model],
        provider({
          allowedModels: ["public-sol"],
          modelRedirects: [{ matchType: "exact", source: "public-sol", target: model.slug }],
        })
      )
    ).toEqual([{ ...model, slug: "public-sol" }]);
    expect(model.slug).toBe("gpt-6.1-sol");
  });

  it("applies ordered regex redirects to concrete candidates with capture expansion", () => {
    const model = nativeModel();
    expect(
      projectCodexModelCatalog(
        [model],
        provider({
          allowedModels: [{ matchType: "exact", pattern: "public-6.1-sol" }],
          modelRedirects: [
            { matchType: "regex", source: "^public-(.+)$", target: "gpt-$1" },
            { matchType: "exact", source: "public-6.1-sol", target: "nonexistent" },
          ],
        })
      )
    ).toEqual([{ ...model, slug: "public-6.1-sol" }]);
  });

  it("filters user model restrictions case insensitively after provider rules", () => {
    const models = [nativeModel(), nativeModel({ slug: "other-model" })];
    expect(projectCodexModelCatalog(models, provider(), ["GPT-6.1-SOL"])).toEqual([models[0]]);
    expect(projectCodexModelCatalog(models, provider(), [])).toEqual(models);
    expect(
      projectCodexModelCatalog(models, provider({ allowedModels: ["other-model"] }), [
        "GPT-6.1-SOL",
      ])
    ).toEqual([]);
  });

  it("does not enumerate regex names or fabricate missing upstream metadata", () => {
    const model = nativeModel();
    expect(
      projectCodexModelCatalog(
        [model],
        provider({
          allowedModels: [
            { matchType: "regex", pattern: "^public-.+$" },
            { matchType: "prefix", pattern: "prefix-" },
          ],
          modelRedirects: [{ matchType: "regex", source: "^public-(.+)$", target: "gpt-$1" }],
        })
      )
    ).toEqual([]);
    expect(
      projectCodexModelCatalog(
        [model],
        provider({
          allowedModels: ["missing-model"],
          modelRedirects: [{ matchType: "exact", source: "missing-model", target: "Gpt-6.1-sol" }],
        })
      )
    ).toEqual([]);
  });

  it("retains native names selected by nonexact provider rules", () => {
    const model = nativeModel();
    expect(
      projectCodexModelCatalog(
        [model],
        provider({ allowedModels: [{ matchType: "prefix", pattern: "gpt-" }] })
      )
    ).toEqual([model]);
  });

  it("discovers an exact redirect alias without a provider allowlist", () => {
    const native = nativeModel();
    expect(
      projectCodexModelCatalog(
        [native],
        provider({
          modelRedirects: [{ matchType: "exact", source: "public-sol", target: native.slug }],
        })
      ).map((model) => model.slug)
    ).toEqual([native.slug, "public-sol"]);
  });

  it("resolves a concrete user alias through regex redirects", () => {
    const native = nativeModel();
    expect(
      projectCodexModelCatalog(
        [native],
        provider({
          allowedModels: [{ matchType: "prefix", pattern: "public-" }],
          modelRedirects: [{ matchType: "regex", source: "^public-(.+)$", target: "gpt-$1" }],
        }),
        ["public-6.1-sol"]
      )
    ).toEqual([{ ...native, slug: "public-6.1-sol" }]);
  });

  it("still applies provider and user permissions to explicit redirect aliases", () => {
    const native = nativeModel();
    const redirects = [{ matchType: "exact" as const, source: "public-sol", target: native.slug }];
    expect(
      projectCodexModelCatalog(
        [native],
        provider({ allowedModels: [native.slug], modelRedirects: redirects }),
        ["public-sol"]
      )
    ).toEqual([]);
    expect(
      projectCodexModelCatalog([native], provider({ modelRedirects: redirects }), ["missing"])
    ).toEqual([]);
  });
});

describe("mergeCodexModelCatalog", () => {
  it("returns a stable empty catalog", () => {
    expect(mergeCodexModelCatalog([])).toEqual({ models: [] });
  });

  it("selects a complete source by priority, then provider id, without unioning native payloads", () => {
    const sources = [
      {
        provider: { id: 1, priority: 20 },
        models: [nativeModel({ base_instructions: "Later priority" })],
      },
      {
        provider: { id: 9, priority: 10 },
        models: [nativeModel({ base_instructions: "Later id" })],
      },
      {
        provider: { id: 2, priority: 10 },
        models: [
          nativeModel({ base_instructions: "Selected", future_capabilities: { tool: "one" } }),
        ],
      },
    ];
    const before = structuredClone(sources);
    const merged = mergeCodexModelCatalog(sources);
    expect(merged.models).toEqual(sources[2].models);
    expect(merged.models[0]).not.toBe(sources[2].models[0]);
    expect(sources).toEqual(before);
  });

  it("takes conservative resolved and maximum windows independently and clamps the default", () => {
    const merged = mergeCodexModelCatalog([
      { provider: { id: 1, priority: 0 }, models: [nativeModel()] },
      {
        provider: { id: 2, priority: 0 },
        models: [nativeModel({ context_window: null, max_context_window: 400000 })],
      },
      {
        provider: { id: 3, priority: 0 },
        models: [nativeModel({ context_window: 272000, max_context_window: null })],
      },
    ]);
    expect(merged.models[0]).toMatchObject({ context_window: 272000, max_context_window: 400000 });

    const clamped = mergeCodexModelCatalog([
      { provider: { id: 1, priority: 0 }, models: [nativeModel()] },
      { provider: { id: 2, priority: 0 }, models: [nativeModel({ max_context_window: 300000 })] },
    ]);
    expect(clamped.models[0]).toMatchObject({ context_window: 300000, max_context_window: 300000 });
  });

  it("ignores absent windows instead of treating them as zero", () => {
    const merged = mergeCodexModelCatalog([
      {
        provider: { id: 1, priority: 0 },
        models: [nativeModel({ context_window: undefined, max_context_window: null })],
      },
      {
        provider: { id: 2, priority: 0 },
        models: [nativeModel({ context_window: 272000, max_context_window: undefined })],
      },
    ]);
    expect(merged.models[0]).toMatchObject({ context_window: 272000, max_context_window: null });
    const noWindows = nativeModel({ context_window: null, max_context_window: null });
    expect(
      mergeCodexModelCatalog([{ provider: { id: 1, priority: 0 }, models: [noWindows] }])
    ).toEqual({
      models: [noWindows],
    });
  });

  it("sorts by slug independently of source enumeration", () => {
    const models = [nativeModel({ slug: "z-model" }), nativeModel({ slug: "a-model" })];
    expect(
      mergeCodexModelCatalog([{ provider: { id: 1, priority: 0 }, models }]).models.map(
        (model) => model.slug
      )
    ).toEqual(["a-model", "z-model"]);
    expect(models.map((model) => model.slug)).toEqual(["z-model", "a-model"]);
  });

  it("clamps compaction to the reduced context while respecting smaller known thresholds", () => {
    const merged = mergeCodexModelCatalog([
      {
        provider: { id: 1, priority: 0 },
        models: [nativeModel({ auto_compact_token_limit: 450000 })],
      },
      {
        provider: { id: 2, priority: 1 },
        models: [nativeModel({ context_window: 200000, auto_compact_token_limit: 180000 })],
      },
    ]);
    expect(merged.models[0]).toMatchObject({
      context_window: 200000,
      auto_compact_token_limit: 180000,
    });
    const clamped = mergeCodexModelCatalog([
      {
        provider: { id: 1, priority: 0 },
        models: [nativeModel({ auto_compact_token_limit: 450000 })],
      },
      { provider: { id: 2, priority: 1 }, models: [nativeModel({ context_window: 200000 })] },
    ]);
    expect(clamped.models[0].auto_compact_token_limit).toBe(200000);
  });

  it("preserves compaction metadata when there is no known context limit", () => {
    const model = nativeModel({
      context_window: null,
      max_context_window: null,
      auto_compact_token_limit: 300000,
    });
    expect(
      mergeCodexModelCatalog([{ provider: { id: 1, priority: 0 }, models: [model] }]).models
    ).toEqual([model]);
  });
});
