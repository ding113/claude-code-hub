import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockFindProviderGroupById = vi.hoisted(() => vi.fn());
const mockRepoUpdateProviderGroup = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getSession: mockGetSession,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/repository/provider-groups", async () => {
  const actual = await vi.importActual<typeof import("@/repository/provider-groups")>(
    "@/repository/provider-groups"
  );
  return {
    ...actual,
    findProviderGroupById: mockFindProviderGroupById,
    updateProviderGroup: mockRepoUpdateProviderGroup,
  };
});

vi.mock("@/lib/audit/emit", () => ({
  emitActionAudit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe("provider-groups action description merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: {
        id: 1,
        role: "admin",
      },
    });
    mockFindProviderGroupById.mockResolvedValue({
      id: 11,
      name: "premium",
      costMultiplier: 1.5,
      description: JSON.stringify({
        note: "Old note",
        publicStatus: {
          displayName: "Premium",
          publicGroupSlug: "premium",
          publicModelKeys: ["gpt-4.1"],
        },
      }),
    });
    mockRepoUpdateProviderGroup.mockResolvedValue({
      id: 11,
      name: "premium",
      costMultiplier: 1.5,
      description: JSON.stringify({
        note: "New note",
        publicStatus: {
          displayName: "Premium",
          publicGroupSlug: "premium",
          publicModelKeys: ["gpt-4.1"],
        },
      }),
    });
  });

  it("preserves publicStatus metadata when updating descriptionNote", async () => {
    const { updateProviderGroup } = await import("@/actions/provider-groups");

    const result = await updateProviderGroup(11, {
      descriptionNote: "New note",
    });

    expect(result.ok).toBe(true);
    expect(mockRepoUpdateProviderGroup).toHaveBeenCalledWith(11, {
      costMultiplier: undefined,
      description: JSON.stringify({
        note: "New note",
        publicStatus: {
          displayName: "Premium",
          publicGroupSlug: "premium",
          publicModelKeys: ["gpt-4.1"],
        },
      }),
    });
  });
});
