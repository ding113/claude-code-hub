import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createUpstreamApiKey,
  fetchUpstreamBalance,
  fetchUpstreamGroupRates,
  isUpstreamUnauthorizedError,
  loginUpstreamSite,
  type UpstreamAuthSession,
  type UpstreamSiteCredentials,
} from "./upstream-connector";

const baseCreds = (): UpstreamSiteCredentials => ({
  siteUrl: "https://example-upstream.test",
  siteType: "sub2api",
  username: "user@example.com",
  password: "secret",
  turnstileEnabled: false,
  captchaProvider: "none",
  captchaApiKey: null,
  captchaEndpoint: null,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("upstream-connector sub2api", () => {
  it("logs in without captcha when public settings have turnstile off", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/settings/public")) {
        return new Response(
          JSON.stringify({ data: { turnstile_enabled: false, turnstile_site_key: "" } }),
          { status: 200 }
        );
      }
      if (url.endsWith("/api/v1/auth/login")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: { access_token: "tok-123", expires_in: 3600 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = await loginUpstreamSite({
      ...baseCreds(),
      // Even with captcha configured, site-off must auto-skip solver.
      turnstileEnabled: true,
      captchaProvider: "yescaptcha",
      captchaApiKey: "yc-key",
    });
    expect(session.accessToken).toBe("tok-123");
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/v1/settings/public"))).toBe(true);
    // No captcha vendor call when site turnstile is off.
    expect(urls.every((u) => !u.includes("yescaptcha") && !u.includes("createTask"))).toBe(true);
  });

  it("fails clearly when site turnstile is on but captcha is not configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/v1/settings/public")) {
          return new Response(
            JSON.stringify({
              data: { turnstile_enabled: true, turnstile_site_key: "0xSITEKEY" },
            }),
            { status: 200 }
          );
        }
        throw new Error(`unexpected url ${url}`);
      })
    );

    await expect(loginUpstreamSite(baseCreds())).rejects.toThrow(/Turnstile enabled/i);
  });

  it("merges available groups with rate overrides", async () => {
    const session: UpstreamAuthSession = {
      accessToken: "tok",
      expiresAt: new Date(Date.now() + 60_000),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/v1/groups/available")) {
          return new Response(
            JSON.stringify({
              code: 0,
              data: [
                { id: 1, name: "Claude Kiro", description: "kiro", rate_multiplier: 0.2 },
                { id: 2, name: "codex-Plus", description: "plus", rate_multiplier: 0.1 },
              ],
            }),
            { status: 200 }
          );
        }
        if (url.endsWith("/api/v1/groups/rates")) {
          return new Response(
            JSON.stringify({
              code: 0,
              data: { "1": 0.15, "2": 0.07 },
            }),
            { status: 200 }
          );
        }
        throw new Error(`unexpected url ${url}`);
      })
    );

    const rates = await fetchUpstreamGroupRates(baseCreds(), session);
    expect(rates).toEqual([
      {
        groupName: "codex-Plus",
        description: "plus",
        ratio: 0.07,
        completionRatio: 0,
      },
      {
        groupName: "Claude Kiro",
        description: "kiro",
        ratio: 0.15,
        completionRatio: 0,
      },
    ]);
  });

  it("auto-creates a key for an empty group then re-lists the secret", async () => {
    const session: UpstreamAuthSession = {
      accessToken: "tok",
      expiresAt: new Date(Date.now() + 60_000),
    };
    let created = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/keys") && (init?.method ?? "GET").toUpperCase() === "POST") {
        created = true;
        const body = JSON.parse(String(init?.body ?? "{}")) as { name?: string; group_id?: number };
        expect(body.group_id).toBe(7);
        expect(body.name).toMatch(/^cch-[0-9a-f]{8}$/);
        return new Response(JSON.stringify({ code: 0, data: { id: 99, name: body.name } }), {
          status: 200,
        });
      }
      if (url.includes("/api/v1/keys?") || url.endsWith("/api/v1/keys")) {
        if (!created) {
          return new Response(JSON.stringify({ code: 0, data: { items: [], pages: 1 } }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              items: [
                {
                  id: 99,
                  key: "sk-auto-plus1-full-secret-value",
                  name: "cch-placeholder",
                  group_id: 7,
                  group: { name: "plus-1" },
                  status: "enabled",
                },
              ],
              pages: 1,
            },
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/api/v1/groups/available")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: [{ id: 7, name: "plus-1" }],
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected url ${url} method=${init?.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const key = await createUpstreamApiKey(baseCreds(), session, { groupName: "plus-1" });
    expect(key).not.toBeNull();
    expect(key?.key).toBe("sk-auto-plus1-full-secret-value");
    expect(key?.groupName).toBe("plus-1");
    expect(created).toBe(true);
  });

  it("returns null when create is rejected so next tick can retry", async () => {
    const session: UpstreamAuthSession = {
      accessToken: "tok",
      expiresAt: new Date(Date.now() + 60_000),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/v1/groups/available")) {
          return new Response(JSON.stringify({ code: 0, data: [{ id: 3, name: "plus-2" }] }), {
            status: 200,
          });
        }
        if (url.endsWith("/api/v1/keys") && (init?.method ?? "GET").toUpperCase() === "POST") {
          return new Response(JSON.stringify({ code: 403, message: "group not allowed" }), {
            status: 200,
          });
        }
        throw new Error(`unexpected url ${url}`);
      })
    );

    const key = await createUpstreamApiKey(baseCreds(), session, { groupName: "plus-2" });
    expect(key).toBeNull();
  });
});

describe("upstream-connector newapi", () => {
  it("marks a 401 response as an expired upstream session", async () => {
    const session: UpstreamAuthSession = {
      cookie: "session=stale",
      userId: "9",
      expiresAt: new Date(Date.now() + 60_000),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
      )
    );

    try {
      await fetchUpstreamGroupRates({ ...baseCreds(), siteType: "newapi" }, session);
      throw new Error("expected fetchUpstreamGroupRates to fail");
    } catch (error) {
      expect(isUpstreamUnauthorizedError(error)).toBe(true);
    }
  });

  it("parses self/groups map and skips non-numeric ratios", async () => {
    const creds = { ...baseCreds(), siteType: "newapi", username: "admin" };
    const session: UpstreamAuthSession = {
      cookie: "session=abc",
      userId: "9",
      expiresAt: new Date(Date.now() + 60_000),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/user/self/groups")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                default: { ratio: 1, desc: "default group" },
                auto: { ratio: "自动", desc: "auto" },
                vip: { ratio: 0.5, desc: "vip" },
              },
            }),
            { status: 200 }
          );
        }
        throw new Error(`unexpected url ${url}`);
      })
    );

    const rates = await fetchUpstreamGroupRates(creds, session);
    expect(rates.map((r) => r.groupName).sort()).toEqual(["default", "vip"]);
    expect(rates.find((r) => r.groupName === "vip")?.ratio).toBe(0.5);
  });

  it("reads newapi daily quota data and converts quota units", async () => {
    const creds = { ...baseCreds(), siteType: "newapi", username: "admin" };
    const session: UpstreamAuthSession = {
      cookie: "session=abc",
      userId: "9",
      expiresAt: new Date(Date.now() + 60_000),
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/status") {
        return new Response(JSON.stringify({ data: { quota_per_unit: 500000 } }), { status: 200 });
      }
      if (url.pathname === "/api/user/self") {
        return new Response(
          JSON.stringify({ success: true, data: { quota: 1500000, used_quota: 4000000 } }),
          { status: 200 }
        );
      }
      if (url.pathname === "/api/data/self") {
        expect(url.searchParams.get("start_timestamp")).toBeTruthy();
        expect(url.searchParams.get("end_timestamp")).toBeTruthy();
        return new Response(
          JSON.stringify({
            success: true,
            data: [{ quota: 100000 }, { quota: "250000" }],
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchUpstreamBalance(creds, session, "UTC")).resolves.toEqual({
      balance: 3,
      todayCost: 0.7,
      totalCost: 8,
    });
  });

  it("keeps an empty newapi daily quota result as zero cost", async () => {
    const creds = { ...baseCreds(), siteType: "newapi", username: "admin" };
    const session: UpstreamAuthSession = {
      cookie: "session=abc",
      userId: "9",
      expiresAt: new Date(Date.now() + 60_000),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/status") {
          return new Response(JSON.stringify({ data: { quota_per_unit: 500000 } }), {
            status: 200,
          });
        }
        if (path === "/api/user/self") {
          return new Response(JSON.stringify({ success: true, data: { quota: 500000 } }), {
            status: 200,
          });
        }
        if (path === "/api/data/self") {
          return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
        }
        throw new Error(`unexpected url ${path}`);
      })
    );

    await expect(fetchUpstreamBalance(creds, session, "UTC")).resolves.toMatchObject({
      todayCost: 0,
    });
  });

  it("creates a token then reveals the full secret from re-list", async () => {
    const creds = { ...baseCreds(), siteType: "newapi", username: "admin" };
    const session: UpstreamAuthSession = {
      cookie: "session=abc",
      userId: "9",
      expiresAt: new Date(Date.now() + 60_000),
    };
    let created = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/token/") && (init?.method ?? "GET").toUpperCase() === "POST") {
          created = true;
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            name?: string;
            group?: string;
            unlimited_quota?: boolean;
          };
          expect(body.group).toBe("plus-1");
          expect(body.unlimited_quota).toBe(true);
          return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
        }
        if (url.includes("/api/token/?")) {
          if (!created) {
            return new Response(JSON.stringify({ success: true, data: { items: [], pages: 1 } }), {
              status: 200,
            });
          }
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                items: [
                  {
                    id: 42,
                    key: "skab****xyz9",
                    name: "cch-auto",
                    group: "plus-1",
                    status: 1,
                  },
                ],
                pages: 1,
              },
            }),
            { status: 200 }
          );
        }
        if (url.endsWith("/api/token/42/key") && (init?.method ?? "GET").toUpperCase() === "POST") {
          return new Response(
            JSON.stringify({ success: true, data: { key: "sk-newapi-full-secret-abcdef" } }),
            { status: 200 }
          );
        }
        throw new Error(`unexpected url ${url} method=${init?.method}`);
      })
    );

    const key = await createUpstreamApiKey(creds, session, { groupName: "plus-1" });
    expect(key?.key).toBe("sk-newapi-full-secret-abcdef");
    expect(key?.groupName).toBe("plus-1");
  });
});
