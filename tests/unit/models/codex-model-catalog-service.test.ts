import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/repository/provider", () => ({ findAllProvidersFresh: vi.fn() }));
vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn().mockResolvedValue("UTC"),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/cache/codex-model-catalog-cache", () => ({
  getCachedCodexModelCatalog: vi.fn(),
}));
vi.mock("@/app/v1/_lib/models/codex-model-catalog-fetcher", () => ({
  prepareCodexModelCatalogSource: vi.fn(),
}));
vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({
  checkProviderGroupMatch: vi.fn((tag: string | null, group: string) => {
    const groups = group.split(",").map((value) => value.trim());
    return groups.includes("*") || (tag || "default").split(",").some((g) => groups.includes(g));
  }),
  ProxyProviderResolver: {
    resolveEffectivePriority: vi.fn(
      (provider: Provider, group: string) => provider.groupPriorities?.[group] ?? provider.priority
    ),
  },
}));

import { prepareCodexModelCatalogSource } from "@/app/v1/_lib/models/codex-model-catalog-fetcher";
import {
  CodexModelCatalogClientDeniedError,
  CodexModelCatalogTooLargeError,
  CodexModelCatalogUnavailableError,
  getCodexModelCatalog,
} from "@/app/v1/_lib/models/codex-model-catalog-service";
import {
  checkProviderGroupMatch,
  ProxyProviderResolver,
} from "@/app/v1/_lib/proxy/provider-selector";
import { getCachedCodexModelCatalog } from "@/lib/cache/codex-model-catalog-cache";
import { CODEX_MODEL_CATALOG_MAX_BYTES, type CodexModelInfo } from "@/lib/codex-model-catalog";
import { findAllProvidersFresh } from "@/repository/provider";
import type { Provider } from "@/types/provider";

const headers = new Headers({ "user-agent": "Codex Desktop/0.164.0" });

function provider(id = 1, overrides: Partial<Provider> = {}): Provider {
  return {
    id,
    name: `source-${id}`,
    url: "https://provider.example/v1",
    key: "upstream-test-key",
    providerType: "codex",
    isEnabled: true,
    priority: id,
    groupPriorities: null,
    groupTag: null,
    activeTimeStart: null,
    activeTimeEnd: null,
    allowedModels: null,
    modelRedirects: null,
    allowedClients: [],
    blockedClients: [],
    ...overrides,
  } as Provider;
}

function model(slug = "gpt-6.1-terra", overrides: Record<string, unknown> = {}): CodexModelInfo {
  return {
    slug,
    display_name: "GPT-6.1 Terra",
    visibility: "list",
    supported_in_api: true,
    context_window: 500_000,
    max_context_window: 872_000,
    base_instructions: "Native model instructions",
    model_messages: { instructions_template: "Native tools and instructions" },
    supported_reasoning_levels: [{ effort: "high", description: "High reasoning" }],
    ...overrides,
  };
}

function auth(
  overrides: Partial<Parameters<typeof getCodexModelCatalog>[0]["user"]> = {},
  group: string | null = null
): Parameters<typeof getCodexModelCatalog>[0] {
  return { user: { id: 1, ...overrides }, key: { providerGroup: group } };
}

function snapshot(models: CodexModelInfo[] = [model()]) {
  return { models, fetchedAt: Date.now(), state: "fresh" as const };
}

describe("native Codex catalog service", () => {
  beforeEach(() => {
    vi.mocked(findAllProvidersFresh).mockResolvedValue([provider()]);
    vi.mocked(prepareCodexModelCatalogSource).mockImplementation((source, clientVersion) => ({
      key: `${source.id}:${clientVersion}`,
      providerId: source.id,
      clientVersion,
      dynamicHeaders: false,
      provider: source,
      url: `${source.url}/models`,
      headers: {},
      timeoutMs: 4000,
    }));
    vi.mocked(getCachedCodexModelCatalog).mockResolvedValue(snapshot());
  });

  it("projects a complete Terra entry and passes the client version and headers to preparation", async () => {
    const result = await getCodexModelCatalog(auth(), "0.164.0", headers);

    expect(result).toEqual({ models: [model()] });
    expect(prepareCodexModelCatalogSource).toHaveBeenCalledWith(provider(), "0.164.0", headers);
    expect(ProxyProviderResolver.resolveEffectivePriority).toHaveBeenCalledWith(
      provider(),
      "default"
    );
  });

  it("re-reads provider eligibility and user permissions for each request, including stale snapshots", async () => {
    vi.mocked(getCachedCodexModelCatalog).mockResolvedValue({
      ...snapshot([model(), model("gpt-6.1-sol")]),
      state: "stale",
    });
    expect((await getCodexModelCatalog(auth(), "0.164.0", headers)).models).toHaveLength(2);
    expect(
      (
        await getCodexModelCatalog(auth({ allowedModels: ["GPT-6.1-TERRA"] }), "0.164.0", headers)
      ).models.map((entry) => entry.slug)
    ).toEqual(["gpt-6.1-terra"]);

    vi.mocked(findAllProvidersFresh).mockResolvedValue([provider(1, { isEnabled: false })]);
    expect(await getCodexModelCatalog(auth(), "0.164.0", headers)).toEqual({ models: [] });
    expect(findAllProvidersFresh).toHaveBeenCalledTimes(3);
    expect(getCachedCodexModelCatalog).toHaveBeenCalledTimes(2);
  });

  it("filters provider type, schedule, key group and client restrictions before cache access", async () => {
    vi.mocked(findAllProvidersFresh).mockResolvedValue([
      provider(1, { providerType: "openai-compatible" }),
      provider(2, { activeTimeStart: "00:00", activeTimeEnd: "00:00" }),
      provider(3, { groupTag: "other" }),
      provider(4, { allowedClients: ["gemini-cli"] }),
      provider(5, { blockedClients: ["codex-cli"] }),
      provider(6, { groupTag: "work", allowedClients: ["codex-cli"] }),
    ]);
    const result = await getCodexModelCatalog(auth({}, "work"), "0.164.0", headers);

    expect(result.models).toHaveLength(1);
    expect(prepareCodexModelCatalogSource).toHaveBeenCalledTimes(1);
    expect(prepareCodexModelCatalogSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: 6 }),
      "0.164.0",
      headers
    );
    expect(checkProviderGroupMatch).toHaveBeenCalledWith("work", "work");
  });

  it("treats null and empty key groups as default without using an unrelated user group", async () => {
    for (const group of [null, ""]) {
      const state = { ...auth({}, group), user: { id: 1, providerGroup: "other" } };
      await getCodexModelCatalog(state, "0.164.0", headers);
    }
    expect(checkProviderGroupMatch).toHaveBeenNthCalledWith(1, null, "default");
    expect(checkProviderGroupMatch).toHaveBeenNthCalledWith(2, null, "default");
  });

  it.each([
    [{ allowedClients: ["gemini-cli"] }, headers],
    [{ allowedClients: ["codex-cli"] }, new Headers()],
    [{ blockedClients: ["codex-cli"] }, headers],
  ])(
    "rejects a user-level client restriction before reading providers",
    async (restrictions, request) => {
      await expect(
        getCodexModelCatalog(auth(restrictions), "0.164.0", request)
      ).rejects.toBeInstanceOf(CodexModelCatalogClientDeniedError);
      expect(findAllProvidersFresh).not.toHaveBeenCalled();
      expect(getCachedCodexModelCatalog).not.toHaveBeenCalled();
    }
  );

  it("permits a blocklist-only user when no User-Agent is present", async () => {
    const result = await getCodexModelCatalog(
      auth({ blockedClients: ["codex-cli"] }),
      "0.164.0",
      new Headers()
    );
    expect(result.models).toHaveLength(1);
  });

  it("isolates preparation failures, missing snapshots, and rejected cache lookups", async () => {
    vi.mocked(findAllProvidersFresh).mockResolvedValue([
      provider(1),
      provider(2),
      provider(3),
      provider(4),
    ]);
    vi.mocked(prepareCodexModelCatalogSource).mockImplementation((source, clientVersion) => {
      if (source.id === 1) throw new Error("Invalid upstream URL");
      return {
        key: String(source.id),
        providerId: source.id,
        clientVersion,
        dynamicHeaders: false,
        provider: source,
        url: `${source.url}/models`,
        headers: {},
        timeoutMs: 4000,
      };
    });
    vi.mocked(getCachedCodexModelCatalog).mockImplementation(async (source) => {
      if (source.providerId === 2) return null;
      if (source.providerId === 3) throw new Error("Redis lookup failed");
      return snapshot();
    });

    expect((await getCodexModelCatalog(auth(), "0.164.0", headers)).models).toHaveLength(1);
  });

  it.each(["prepare", "missing", "reject"])(
    "fails explicitly when every eligible source is unavailable: %s",
    async (failure) => {
      if (failure === "prepare") {
        vi.mocked(prepareCodexModelCatalogSource).mockImplementation(() => {
          throw new Error("Invalid source");
        });
      } else if (failure === "missing") {
        vi.mocked(getCachedCodexModelCatalog).mockResolvedValue(null);
      } else {
        vi.mocked(getCachedCodexModelCatalog).mockRejectedValue(new Error("Unavailable cache"));
      }

      await expect(getCodexModelCatalog(auth(), "0.164.0", headers)).rejects.toBeInstanceOf(
        CodexModelCatalogUnavailableError
      );
    }
  );

  it("distinguishes a successful empty upstream directory from unavailable sources", async () => {
    vi.mocked(findAllProvidersFresh).mockResolvedValue([provider(1), provider(2)]);
    vi.mocked(getCachedCodexModelCatalog)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(snapshot([]));
    expect(await getCodexModelCatalog(auth(), "0.164.0", headers)).toEqual({ models: [] });
  });

  it("returns a genuinely empty result after current model permission filtering", async () => {
    expect(
      await getCodexModelCatalog(auth({ allowedModels: ["different-model"] }), "0.164.0", headers)
    ).toEqual({ models: [] });
  });

  it("uses group effective priority for complete metadata while reconciling context limits", async () => {
    vi.mocked(findAllProvidersFresh).mockResolvedValue([
      provider(1, { groupTag: "work", priority: 1 }),
      provider(2, { groupTag: "work", priority: 10, groupPriorities: { work: 0 } }),
    ]);
    vi.mocked(getCachedCodexModelCatalog)
      .mockResolvedValueOnce(snapshot([model("gpt-6.1-terra", { context_window: 200_000 })]))
      .mockResolvedValueOnce(
        snapshot([
          model("gpt-6.1-terra", { base_instructions: "Chosen group-specific instructions" }),
        ])
      );

    const result = await getCodexModelCatalog(auth({}, "work"), "0.164.0", headers);
    expect(result.models[0]).toMatchObject({
      base_instructions: "Chosen group-specific instructions",
      context_window: 200_000,
    });
  });

  it("projects an exact public alias using native target metadata", async () => {
    vi.mocked(findAllProvidersFresh).mockResolvedValue([
      provider(1, {
        allowedModels: ["public-terra"],
        modelRedirects: [{ matchType: "exact", source: "public-terra", target: "gpt-6.1-terra" }],
      }),
    ]);
    const result = await getCodexModelCatalog(
      auth({ allowedModels: ["PUBLIC-TERRA"] }),
      "0.164.0",
      headers
    );
    expect(result.models).toEqual([{ ...model(), slug: "public-terra" }]);
  });

  it("measures the UTF-8 size of the complete projected directory and does not truncate instructions", async () => {
    vi.mocked(getCachedCodexModelCatalog).mockResolvedValue(
      snapshot([model("gpt-6.1-terra", { base_instructions: "界".repeat(350_000) })])
    );

    try {
      await getCodexModelCatalog(auth(), "0.164.0", headers);
      expect.unreachable("Expected the native directory to exceed the byte limit");
    } catch (error) {
      expect(error).toBeInstanceOf(CodexModelCatalogTooLargeError);
      expect((error as CodexModelCatalogTooLargeError).bytes).toBeGreaterThan(
        CODEX_MODEL_CATALOG_MAX_BYTES
      );
    }
  });
});
