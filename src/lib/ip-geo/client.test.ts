import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { IpGeoLookupResult } from "@/types/ip-geo";

const SAMPLE_LOOKUP = {
  ip: "8.8.8.8",
  version: "ipv4",
  hostname: "dns.google",
  location: {
    continent: { code: "NA", name: "North America" },
    country: {
      code: "US",
      code3: "USA",
      name: "United States",
      name_native: "United States",
      capital: "Washington, D.C.",
      calling_code: "+1",
      tld: ".us",
      area_km2: 9629091,
      population: 340110988,
      borders: ["CA", "MX"],
      is_eu_member: false,
      flag: { emoji: "US", unicode: "U+1F1FA U+1F1F8", svg: "", png: "" },
      languages: [{ code: "en", name: "English", name_native: "English" }],
      currencies: [
        {
          code: "USD",
          name: "US Dollar",
          symbol: "$",
          symbol_native: "$",
          format: { decimal_separator: ".", group_separator: "," },
        },
      ],
    },
    region: { code: "US-CA", name: "California", type: "state" },
    city: "Mountain View",
    postal_code: "94043",
    coordinates: { latitude: 37.4, longitude: -122.07, accuracy_radius_km: 5 },
  },
  timezone: {
    id: "America/Los_Angeles",
    name: "Pacific Standard Time",
    abbreviation: "PST",
    utc_offset: "-07:00",
    utc_offset_seconds: -25200,
    is_dst: true,
    current_time: "2026-04-17T05:12:29-07:00",
  },
  connection: {
    asn: 15169,
    handle: "GOOGLE",
    organization: "Google LLC",
    domain: "google.com",
    route: "8.8.8.0/24",
    rir: "ARIN",
    type: "hosting",
    subtype: "cloud",
    scope: "public",
    is_anycast: true,
  },
  company: { name: "Google LLC", domain: "google.com", type: "hosting" },
  carrier: null,
  hosting: { provider: "Google Cloud", domain: "cloud.google.com", network: "8.8.8.0/24" },
  privacy: {
    is_proxy: false,
    is_vpn: false,
    is_tor: false,
    is_tor_exit: false,
    is_relay: false,
    is_anonymous: false,
  },
  threat: {
    is_abuser: false,
    is_attacker: false,
    is_crawler: false,
    is_threat: false,
    score: 0.004,
    risk_level: "low",
    blocklists: [],
  },
  abuse: { name: "Google LLC", email: "network-abuse@google.com", phone: null, address: null },
} satisfies IpGeoLookupResult;

const redisStore = new Map<string, string>();
const redisExpires = new Map<string, number>();

function makeFakeRedis() {
  return {
    get: vi.fn(async (key: string) => {
      const v = redisStore.get(key);
      if (!v) return null;
      const exp = redisExpires.get(key);
      if (exp && exp < Date.now()) {
        redisStore.delete(key);
        redisExpires.delete(key);
        return null;
      }
      return v;
    }),
    set: vi.fn(async (key: string, value: string, mode?: string, ttl?: number) => {
      redisStore.set(key, value);
      if (mode === "EX" && typeof ttl === "number") {
        redisExpires.set(key, Date.now() + ttl * 1000);
      }
      return "OK";
    }),
  };
}

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: vi.fn(),
}));

vi.mock("@/lib/config/env.schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/env.schema")>();
  return {
    ...actual,
    getEnvConfig: () => ({
      ...actual.getEnvConfig(),
      IP_GEO_API_URL: "https://ip.api.example.com",
      IP_GEO_API_TOKEN: "test-token",
      IP_GEO_CACHE_TTL_SECONDS: 3600,
      IP_GEO_TIMEOUT_MS: 1500,
    }),
  };
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(async () => {
  redisStore.clear();
  redisExpires.clear();
  fetchMock.mockReset();
  const { getRedisClient } = await import("@/lib/redis/client");
  (getRedisClient as ReturnType<typeof vi.fn>).mockReturnValue(makeFakeRedis());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("lookupIp — successful lookup", () => {
  test("returns ok + caches result; second call hits cache and skips fetch", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE_LOOKUP), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const { lookupIp } = await import("./client");

    const first = await lookupIp("8.8.8.8");
    expect(first.status).toBe("ok");
    if (first.status === "ok") {
      expect(first.data.location.country.code).toBe("US");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await lookupIp("8.8.8.8");
    expect(second.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1); // still 1 — cache hit
  });

  test("sends Bearer token when IP_GEO_API_TOKEN is set", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(SAMPLE_LOOKUP), { status: 200 }));
    const { lookupIp } = await import("./client");
    await lookupIp("1.1.1.1");

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("authorization")).toBe("Bearer test-token");
  });
});

describe("lookupIp — degradation", () => {
  test("private IP is short-circuited without upstream call", async () => {
    const { lookupIp } = await import("./client");
    const result = await lookupIp("10.0.0.1");
    expect(result.status).toBe("private");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test("non-200 upstream returns error and caches negative result briefly", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const { lookupIp } = await import("./client");

    const first = await lookupIp("2.2.2.2");
    expect(first.status).toBe("error");

    const second = await lookupIp("2.2.2.2");
    expect(second.status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1); // negative cached
  });

  test("network error returns error", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    const { lookupIp } = await import("./client");
    const result = await lookupIp("3.3.3.3");
    expect(result.status).toBe("error");
  });

  test("malformed JSON returns error", async () => {
    fetchMock.mockResolvedValue(new Response("{not-json", { status: 200 }));
    const { lookupIp } = await import("./client");
    const result = await lookupIp("4.4.4.4");
    expect(result.status).toBe("error");
  });

  test("invalid IP input returns error", async () => {
    const { lookupIp } = await import("./client");
    const result = await lookupIp("not-an-ip");
    expect(result.status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test("honors timeout — aborts slow upstream", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );

    const { lookupIp } = await import("./client");
    const result = await lookupIp("5.5.5.5");
    expect(result.status).toBe("error");
  });
});
