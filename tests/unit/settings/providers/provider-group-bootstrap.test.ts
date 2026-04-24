import { describe, expect, it, vi } from "vitest";

interface ProviderGroupBootstrapModule {
  bootstrapProviderGroupsFromProviders(input: {
    findAllProviderGroups: () => Promise<
      Array<{
        id: number;
        name: string;
        costMultiplier: number;
        description: string | null;
        createdAt: Date;
        updatedAt: Date;
      }>
    >;
    findAllProvidersFresh: () => Promise<Array<{ groupTag: string | null }>>;
    ensureProviderGroupsExist: (names: string[]) => Promise<void>;
    logSelfHealFailure?: (error: unknown, missing: string[]) => void;
  }): Promise<{
    groups: Array<{
      id: number;
      name: string;
      costMultiplier: number;
      description: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    groupCounts: Map<string, number>;
  }>;
}

describe("provider-group bootstrap", () => {
  it("self-heals missing referenced groups and returns counts shared by providers/status-page", async () => {
    const mod = (await import(
      "@/lib/provider-groups/bootstrap"
    )) as unknown as ProviderGroupBootstrapModule;

    const now = new Date("2026-04-22T00:00:00.000Z");
    const ensureProviderGroupsExist = vi.fn(async () => {});
    let currentGroups = [
      {
        id: 1,
        name: "default",
        costMultiplier: 1,
        description: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 2,
        name: "openai",
        costMultiplier: 1,
        description: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const result = await mod.bootstrapProviderGroupsFromProviders({
      findAllProviderGroups: async () => currentGroups,
      findAllProvidersFresh: async () => [
        { groupTag: null },
        { groupTag: "   " },
        { groupTag: "default" },
        { groupTag: "openai,premium" },
        { groupTag: "premium" },
      ],
      ensureProviderGroupsExist: async (names) => {
        ensureProviderGroupsExist(names);
        currentGroups = [
          ...currentGroups,
          {
            id: 3,
            name: "premium",
            costMultiplier: 1,
            description: null,
            createdAt: now,
            updatedAt: now,
          },
        ];
      },
    });

    expect(ensureProviderGroupsExist).toHaveBeenCalledWith(["premium"]);
    expect(result.groups.map((group) => group.name)).toEqual(["default", "openai", "premium"]);
    expect(result.groupCounts.get("default")).toBe(3);
    expect(result.groupCounts.get("openai")).toBe(1);
    expect(result.groupCounts.get("premium")).toBe(2);
  });
});
