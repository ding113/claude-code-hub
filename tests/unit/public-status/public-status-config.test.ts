import { describe, expect, it } from "vitest";
import { importPublicStatusModule } from "../../helpers/public-status-test-helpers";

interface PublicStatusConfigModule {
  parsePublicStatusDescription(description: string | null | undefined): {
    note: string | null;
    publicStatus: {
      displayName?: string;
      publicGroupSlug?: string;
      explanatoryCopy?: string | null;
      sortOrder?: number;
      publicModels?: Array<{
        modelKey: string;
        providerTypeOverride?: string;
      }>;
    } | null;
  };
  serializePublicStatusDescription(input: unknown): string | null;
  collectEnabledPublicStatusGroups(input: unknown): unknown[];
}

describe("public-status config", () => {
  it("round-trips the versioned publicModels contract with provider overrides", async () => {
    const mod = await importPublicStatusModule<PublicStatusConfigModule>(
      "@/lib/public-status/config"
    );

    const serialized = mod.serializePublicStatusDescription({
      note: "Primary public note",
      publicStatus: {
        displayName: "OpenAI",
        publicGroupSlug: "openai",
        explanatoryCopy: "Public models",
        sortOrder: 10,
        publicModels: [
          { modelKey: "gpt-4.1", providerTypeOverride: "codex" },
          { modelKey: "gpt-4o-mini" },
        ],
      },
    });

    expect(serialized).toContain('"version":2');

    const parsed = mod.parsePublicStatusDescription(serialized);
    expect(parsed).toEqual({
      note: "Primary public note",
      publicStatus: {
        displayName: "OpenAI",
        publicGroupSlug: "openai",
        explanatoryCopy: "Public models",
        sortOrder: 10,
        publicModels: [
          { modelKey: "gpt-4.1", providerTypeOverride: "codex" },
          { modelKey: "gpt-4o-mini" },
        ],
      },
    });
  });

  it("upgrades legacy publicModelKeys and modelIds arrays into publicModels entries", async () => {
    const mod = await importPublicStatusModule<PublicStatusConfigModule>(
      "@/lib/public-status/config"
    );

    const fromPublicModelKeys = mod.parsePublicStatusDescription(
      JSON.stringify({
        note: "Legacy keys",
        publicStatus: {
          displayName: "Legacy A",
          publicModelKeys: ["gpt-4.1", "gpt-4.1", "claude-3.7-sonnet"],
        },
      })
    );
    const fromModelIds = mod.parsePublicStatusDescription(
      JSON.stringify({
        note: "Legacy ids",
        publicStatus: {
          displayName: "Legacy B",
          modelIds: ["gemini-2.5-pro", "gemini-2.5-pro", "o3"],
        },
      })
    );

    expect(fromPublicModelKeys.publicStatus?.publicModels).toEqual([
      { modelKey: "gpt-4.1" },
      { modelKey: "claude-3.7-sonnet" },
    ]);
    expect(fromModelIds.publicStatus?.publicModels).toEqual([
      { modelKey: "gemini-2.5-pro" },
      { modelKey: "o3" },
    ]);
  });

  it("preserves malformed descriptions as note-only payloads", async () => {
    const mod = await importPublicStatusModule<PublicStatusConfigModule>(
      "@/lib/public-status/config"
    );

    expect(mod.parsePublicStatusDescription("{broken-json")).toEqual({
      note: "{broken-json",
      publicStatus: null,
    });
  });

  it("drops groups whose models become empty after normalization", async () => {
    const mod = await importPublicStatusModule<PublicStatusConfigModule>(
      "@/lib/public-status/config"
    );

    expect(
      mod.collectEnabledPublicStatusGroups([
        {
          groupName: "openai",
          note: null,
          publicStatus: {
            displayName: "OpenAI",
            publicModels: [{ modelKey: "   " }],
          },
        },
      ])
    ).toEqual([]);
  });

  it("ignores null and primitive entries in publicModels arrays", async () => {
    const mod = await importPublicStatusModule<PublicStatusConfigModule>(
      "@/lib/public-status/config"
    );

    expect(
      mod.parsePublicStatusDescription(
        JSON.stringify({
          version: 2,
          publicStatus: {
            publicModels: [null, 42, { modelKey: "gpt-4.1", providerTypeOverride: "codex" }],
          },
        })
      )
    ).toMatchObject({
      note: null,
      publicStatus: {
        publicModels: [{ modelKey: "gpt-4.1", providerTypeOverride: "codex" }],
      },
    });
  });
});
