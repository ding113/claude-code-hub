import { describe, expect, it } from "vitest";

describe("public-status selected models", () => {
  it("preserves provider overrides for retained models and deduplicates the next selection", async () => {
    const { syncSelectedPublicStatusModels } = await import(
      "@/app/[locale]/settings/status-page/_components/public-status-models"
    );

    expect(
      syncSelectedPublicStatusModels(
        [
          { modelKey: "gpt-4.1", providerTypeOverride: "codex" },
          { modelKey: "claude-3.7-sonnet", providerTypeOverride: "claude" },
        ],
        ["gpt-4.1", "gemini-2.5-pro", "gpt-4.1"]
      )
    ).toEqual([
      { modelKey: "gpt-4.1", providerTypeOverride: "codex" },
      { modelKey: "gemini-2.5-pro" },
    ]);
  });
});
