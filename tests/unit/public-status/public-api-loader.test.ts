import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPublicStatusGet = vi.hoisted(() => vi.fn());
const mockPublicSiteMetaGet = vi.hoisted(() => vi.fn());

vi.mock("@/app/api/public-status/route", () => ({
  GET: mockPublicStatusGet,
}));

vi.mock("@/app/api/public-site-meta/route", () => ({
  GET: mockPublicSiteMetaGet,
}));

describe("public status public API loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("loads the status page through the public route contract", async () => {
    mockPublicStatusGet.mockResolvedValue(
      new Response(
        JSON.stringify({
          generatedAt: "2026-04-22T10:00:00.000Z",
          freshUntil: "2026-04-22T10:05:00.000Z",
          status: "ready",
          rebuildState: {
            state: "fresh",
            hasSnapshot: true,
            reason: null,
          },
          defaults: {
            intervalMinutes: 5,
            rangeHours: 24,
          },
          resolvedQuery: {
            intervalMinutes: 5,
            rangeHours: 24,
            groupSlugs: ["anthropic"],
            models: [],
            statuses: [],
            q: null,
            include: ["meta", "defaults", "groups", "timeline"],
          },
          meta: {
            siteTitle: "Claude Code Hub",
            siteDescription: "Claude Code Hub public status",
            timeZone: "UTC",
          },
          groups: [
            {
              publicGroupSlug: "anthropic",
              displayName: "Anthropic",
              explanatoryCopy: "Anthropic public models",
              models: [],
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );

    const { loadPublicStatusPageData } = await import("@/lib/public-status/public-api-loader");
    const result = await loadPublicStatusPageData({ groupSlug: "anthropic" });
    const request = mockPublicStatusGet.mock.calls[0][0] as Request;

    expect(request.url).toBe("http://localhost/api/public-status?groupSlug=anthropic");
    expect(result.status).toBe("ready");
    expect(result.siteTitle).toBe("Claude Code Hub");
    expect(result.timeZone).toBe("UTC");
    expect(result.initialPayload.groups).toHaveLength(1);
  });

  it("maps route-level invalid-query failures to a deterministic loader error", async () => {
    mockPublicStatusGet.mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid public status query parameters" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      })
    );

    const { loadPublicStatusPageData } = await import("@/lib/public-status/public-api-loader");

    await expect(loadPublicStatusPageData({ groupSlug: "bad" })).rejects.toThrow(
      "PUBLIC_STATUS_INVALID_QUERY"
    );
  });

  it("continues to consume rebuilding payloads from a 503 public-status response", async () => {
    mockPublicStatusGet.mockResolvedValue(
      new Response(
        JSON.stringify({
          generatedAt: null,
          freshUntil: null,
          status: "rebuilding",
          rebuildState: {
            state: "rebuilding",
            hasSnapshot: false,
            reason: null,
          },
          defaults: {
            intervalMinutes: 5,
            rangeHours: 24,
          },
          resolvedQuery: {
            intervalMinutes: 5,
            rangeHours: 24,
            groupSlugs: [],
            models: [],
            statuses: [],
            q: null,
            include: ["meta", "defaults", "groups", "timeline"],
          },
          meta: null,
          groups: [],
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );

    const { loadPublicStatusPageData } = await import("@/lib/public-status/public-api-loader");
    const result = await loadPublicStatusPageData();

    expect(result.status).toBe("rebuilding");
    expect(result.initialPayload.rebuildState).toBe("rebuilding");
    expect(result.initialPayload.groups).toEqual([]);
  });

  it("loads public site metadata through the public route contract", async () => {
    mockPublicSiteMetaGet.mockResolvedValue(
      new Response(
        JSON.stringify({
          available: true,
          siteTitle: "Claude Code Hub",
          siteDescription: "Claude Code Hub public status",
          timeZone: "UTC",
          source: "projection",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );

    const { loadPublicSiteMeta } = await import("@/lib/public-status/public-api-loader");

    await expect(loadPublicSiteMeta()).resolves.toEqual({
      available: true,
      siteTitle: "Claude Code Hub",
      siteDescription: "Claude Code Hub public status",
      timeZone: "UTC",
      source: "projection",
    });
    expect(mockPublicSiteMetaGet).toHaveBeenCalledTimes(1);
  });
});
