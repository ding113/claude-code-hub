import { describe, expect, it } from "vitest";
import {
  collectEnabledPublicStatusGroups,
  hasConfiguredPublicStatusTargets,
  parsePublicStatusDescription,
  serializePublicStatusDescription,
} from "@/lib/public-status/config";

describe("public status group config", () => {
  it("parses legacy plain-text description as note-only and keeps feature disabled", () => {
    const parsed = parsePublicStatusDescription("legacy provider group note");

    expect(parsed.note).toBe("legacy provider group note");
    expect(parsed.publicStatus).toBeNull();
    expect(hasConfiguredPublicStatusTargets([parsed])).toBe(false);
  });

  it("serializes and parses structured public status config round-trip", () => {
    const serialized = serializePublicStatusDescription({
      note: "keep this note",
      publicStatus: {
        displayName: "OpenAI Public",
        modelIds: ["gpt-4.1", "o3"],
      },
    });

    expect(serialized).not.toBeNull();
    expect(serialized!.length).toBeLessThanOrEqual(500);

    const parsed = parsePublicStatusDescription(serialized);

    expect(parsed).toEqual({
      note: "keep this note",
      publicStatus: {
        displayName: "OpenAI Public",
        modelIds: ["gpt-4.1", "o3"],
      },
    });
  });

  it("only enables public status aggregation when at least one group has non-empty model ids", () => {
    const groups = [
      {
        groupName: "default",
        ...parsePublicStatusDescription(null),
      },
      {
        groupName: "alpha",
        ...parsePublicStatusDescription(
          serializePublicStatusDescription({
            publicStatus: {
              displayName: "Alpha",
              modelIds: [],
            },
          })
        ),
      },
      {
        groupName: "beta",
        ...parsePublicStatusDescription(
          serializePublicStatusDescription({
            publicStatus: {
              displayName: "Beta",
              modelIds: ["claude-sonnet-4-5"],
            },
          })
        ),
      },
    ];

    expect(hasConfiguredPublicStatusTargets(groups)).toBe(true);
    expect(collectEnabledPublicStatusGroups(groups)).toEqual([
      {
        groupName: "beta",
        displayName: "Beta",
        modelIds: ["claude-sonnet-4-5"],
      },
    ]);
  });
});
