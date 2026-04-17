/**
 * @vitest-environment happy-dom
 */

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { IpGeoLookupResponse, IpGeoLookupResult } from "@/types/ip-geo";
import ipDetailsMessages from "../../../../../messages/en/ipDetails.json";

const useIpGeoMocks = vi.hoisted(() => ({
  useIpGeo:
    vi.fn<
      (ip: string | null | undefined) => {
        data?: IpGeoLookupResponse;
        isLoading: boolean;
        isError: boolean;
      }
    >(),
}));
vi.mock("@/hooks/use-ip-geo", () => useIpGeoMocks);

const clipboardMocks = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn<(text: string) => Promise<boolean>>(),
}));
vi.mock("@/lib/utils/clipboard", () => clipboardMocks);

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: toastMocks,
}));

import { hasMeaningfulCoordinates, IpDetailsDialog } from "./ip-details-dialog";

const messages = { ipDetails: ipDetailsMessages };

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function allText(): string {
  return document.body.textContent ?? "";
}

// Real-world payload for a Tailscale / CGN IP (100.64/10). Upstream filled
// what it could — carrier/NAT org + hostname — and nulled the rest.
const CGN_RESPONSE: IpGeoLookupResponse = {
  status: "ok",
  data: {
    ip: "100.85.244.112",
    version: "ipv4",
    hostname: "dings-macbook-pro.taile7ff02.ts.net",
    location: {
      continent: { code: "AN", name: "Unknown" },
      country: {
        code: "ZZ",
        code3: "ZZZ",
        name: "Unknown",
        name_native: "Unknown",
        capital: null,
        calling_code: "+0",
        tld: ".unknown",
        area_km2: 0,
        population: 0,
        borders: [],
        is_eu_member: false,
        flag: { emoji: "🇿🇿", unicode: "U+1F1FF U+1F1FF", svg: null, png: null },
        languages: [],
        currencies: [],
      },
      region: null,
      city: null,
      postal_code: null,
      coordinates: { latitude: 0, longitude: 0, accuracy_radius_km: null },
    },
    timezone: {
      id: "UTC",
      name: "Coordinated Universal Time",
      abbreviation: "UTC",
      utc_offset: "+00:00",
      utc_offset_seconds: 0,
      is_dst: false,
      current_time: "2026-04-17T08:31:24Z",
    },
    connection: {
      asn: null,
      handle: null,
      organization: "Carrier-Grade NAT RFC6598",
      domain: null,
      route: null,
      rir: "UNKNOWN",
      type: "unknown",
      subtype: null,
      scope: "bogon",
      is_anycast: false,
    },
    company: { name: "Carrier-Grade NAT RFC6598", domain: null, type: "unknown" },
    carrier: null,
    hosting: null,
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
      score: 0,
      risk_level: "none",
      blocklists: [],
    },
    abuse: null,
  },
};

describe("hasMeaningfulCoordinates", () => {
  test("returns false when accuracy_radius_km is null (CGN / bogon / tailscale)", () => {
    expect(hasMeaningfulCoordinates({ latitude: 0, longitude: 0, accuracy_radius_km: null })).toBe(
      false
    );

    // Even a non-zero pair with null accuracy is untrusted — `null` means
    // "we don't know", not "exact".
    expect(
      hasMeaningfulCoordinates({ latitude: 37.4, longitude: -122.07, accuracy_radius_km: null })
    ).toBe(false);
  });

  test("returns false for the 0,0 null-island fallback", () => {
    expect(hasMeaningfulCoordinates({ latitude: 0, longitude: 0, accuracy_radius_km: 100 })).toBe(
      false
    );
  });

  test("returns true for real coordinates with a known accuracy", () => {
    expect(
      hasMeaningfulCoordinates({ latitude: 37.4, longitude: -122.07, accuracy_radius_km: 5 })
    ).toBe(true);

    // Edge case: very small accuracy but real lat/lng.
    expect(
      hasMeaningfulCoordinates({ latitude: -33.8, longitude: 151.2, accuracy_radius_km: 1 })
    ).toBe(true);
  });

  test("returns true for accuracy of 0 with real coordinates", () => {
    // 0 != null — means "exact" not "unknown".
    expect(
      hasMeaningfulCoordinates({ latitude: 1.23, longitude: 4.56, accuracy_radius_km: 0 })
    ).toBe(true);
  });
});

describe("IpDetailsDialog: partial payload rendering (CGN / bogon / tailscale)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    clipboardMocks.copyTextToClipboard.mockResolvedValue(true);
    useIpGeoMocks.useIpGeo.mockReturnValue({
      data: CGN_RESPONSE,
      isLoading: false,
      isError: false,
    });
  });

  test("hides null asn, null route, and 0,0 null-accuracy coordinates rows", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IpDetailsDialog ip="100.85.244.112" open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    );

    const text = allText();

    // Must NOT show the "ASnull" garbage render or a bare ASN row label.
    expect(text).not.toMatch(/ASnull/i);
    // The 0,0 coordinate string must not appear (accuracy null → hide).
    expect(text).not.toMatch(/\b0,\s*0\b/);

    // Things that ARE present in the CGN payload should still render so the
    // dialog is useful rather than near-empty:
    expect(text).toContain("Carrier-Grade NAT RFC6598"); // organization
    expect(text).toContain("dings-macbook-pro.taile7ff02.ts.net"); // hostname
    expect(text).toContain("UTC"); // timezone id

    unmount();
  });

  test("RIR row hidden when upstream returns 'UNKNOWN' sentinel", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IpDetailsDialog ip="100.85.244.112" open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    );

    const text = allText();
    // "UNKNOWN" RIR is a placeholder, not useful information — should be hidden.
    expect(text).not.toMatch(/\bUNKNOWN\b/);

    unmount();
  });

  test("anycast row hidden when is_anycast is false (the common case)", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IpDetailsDialog ip="100.85.244.112" open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    );

    const text = allText();
    // Anycast label should not appear when the flag is false.
    expect(text).not.toContain("Anycast");

    unmount();
  });

  test("copies the full ip from dialog header", async () => {
    const ip = "2001:0db8:85a3:0000:0000:8a2e:0370:7334";
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IpDetailsDialog ip={ip} open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    );

    const copyButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === ipDetailsMessages.actions.copy
    );

    expect(copyButton).toBeTruthy();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(clipboardMocks.copyTextToClipboard).toHaveBeenCalledWith(ip);
    expect(toastMocks.success).toHaveBeenCalledWith(ipDetailsMessages.actions.copySuccess);

    unmount();
  });

  test("hides abuse section when abuse payload is null", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IpDetailsDialog ip="100.85.244.112" open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    );

    const text = allText();
    // Abuse section header must not render when abuse is null on the payload.
    expect(text).not.toContain(ipDetailsMessages.sections.abuse);

    unmount();
  });

  test("hides country sub-card when country is the 'ZZ' unknown marker", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IpDetailsDialog ip="100.85.244.112" open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    );

    const text = allText();
    // No bogus capital / TLD / calling-code rows should leak through.
    expect(text).not.toContain(ipDetailsMessages.fields.capital);
    expect(text).not.toContain(ipDetailsMessages.fields.callingCode);
    expect(text).not.toContain(".unknown");
    // Country section header itself should also not render.
    expect(text).not.toContain(ipDetailsMessages.sections.country);

    unmount();
  });
});

// Full-data payload for a public, well-populated IP like 8.8.8.8.
const FULL_RESPONSE: IpGeoLookupResponse = {
  status: "ok",
  data: {
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
        flag: { emoji: "🇺🇸", unicode: "U+1F1FA U+1F1F8", svg: null, png: null },
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
      coordinates: { latitude: 37.40567, longitude: -122.07746, accuracy_radius_km: 5 },
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
    abuse: {
      name: "Google LLC",
      email: "network-abuse@google.com",
      phone: "+1-650-253-0000",
      address: "1600 Amphitheatre Parkway, Mountain View, CA, 94043, US",
    },
  },
};

describe("IpDetailsDialog: full-data rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    useIpGeoMocks.useIpGeo.mockReturnValue({
      data: FULL_RESPONSE,
      isLoading: false,
      isError: false,
    });
  });

  test("surfaces risk/location/network hero facts without scrolling", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IpDetailsDialog ip="8.8.8.8" open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    );

    const text = allText();

    // Risk hero — level + numeric score.
    expect(text).toContain(ipDetailsMessages.riskLevels.low);
    expect(text).toContain("0.004");

    // Location hero — country + city/region.
    expect(text).toContain("United States");
    expect(text).toContain("Mountain View");
    expect(text).toContain("California");

    // Network hero — ASN + org + type badge.
    expect(text).toContain("AS15169");
    expect(text).toContain("Google LLC");
    expect(text).toContain(ipDetailsMessages.networkTypes.hosting);

    // Anycast flag IS shown when true.
    expect(text).toContain(ipDetailsMessages.badges.anycast);

    unmount();
  });

  test("renders hosting and company sub-cards plus full abuse contact", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IpDetailsDialog ip="8.8.8.8" open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    );

    const text = allText();

    // Hosting sub-card
    expect(text).toContain(ipDetailsMessages.sections.hosting);
    expect(text).toContain("Google Cloud");
    expect(text).toContain("cloud.google.com");

    // Company sub-card
    expect(text).toContain(ipDetailsMessages.sections.company);

    // Country sub-card is collapsed by default (trivia like capital,
    // calling code, and TLD should not render until the user expands it).
    expect(text).toContain(ipDetailsMessages.sections.country);
    expect(text).not.toContain("Washington, D.C.");
    expect(text).not.toContain(".us");

    // Abuse section with phone + address
    expect(text).toContain("network-abuse@google.com");
    expect(text).toContain("+1-650-253-0000");
    expect(text).toContain("1600 Amphitheatre Parkway");

    unmount();
  });

  test("shows clean hint when no privacy/threat signals are active", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IpDetailsDialog ip="8.8.8.8" open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    );

    const text = allText();
    expect(text).toContain(ipDetailsMessages.hero.cleanHint);

    unmount();
  });
});

describe("IpDetailsDialog: high-risk rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  test("renders active privacy chips and blocklist entries", () => {
    const risky: IpGeoLookupResponse = {
      status: "ok",
      data: {
        ...FULL_RESPONSE.data,
        privacy: {
          is_proxy: false,
          is_vpn: false,
          is_tor: true,
          is_tor_exit: true,
          is_relay: false,
          is_anonymous: true,
        },
        threat: {
          is_abuser: true,
          is_attacker: false,
          is_crawler: false,
          is_threat: true,
          score: 0.82,
          risk_level: "critical",
          blocklists: [
            { name: "Spamhaus SBL", category: "spam", listed_at: "2026-03-20T10:00:00Z" },
            { name: "AbuseIPDB", category: "abuse", listed_at: "2026-04-01T14:30:00Z" },
          ],
        },
      },
    } as IpGeoLookupResponse;

    useIpGeoMocks.useIpGeo.mockReturnValue({
      data: risky,
      isLoading: false,
      isError: false,
    });

    const relativeTimeShort = {
      now: "just now",
      secondsAgo: "{count}s ago",
      minutesAgo: "{count}m ago",
      hoursAgo: "{count}h ago",
      daysAgo: "{count}d ago",
      weeksAgo: "{count}w ago",
      monthsAgo: "{count}mo ago",
      yearsAgo: "{count}y ago",
    };

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={{ ...messages, common: { relativeTimeShort } }}>
        <IpDetailsDialog ip="203.0.113.9" open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    );

    const text = allText();

    // Risk surfaces immediately.
    expect(text).toContain(ipDetailsMessages.riskLevels.critical);
    expect(text).toContain("0.820");

    // Active privacy + threat badges are visible in the hero.
    expect(text).toContain(ipDetailsMessages.badges.tor);
    expect(text).toContain(ipDetailsMessages.badges.torExit);
    expect(text).toContain(ipDetailsMessages.badges.abuser);

    // Blocklist entries and categories.
    expect(text).toContain(ipDetailsMessages.sections.blocklists);
    expect(text).toContain("Spamhaus SBL");
    expect(text).toContain("AbuseIPDB");

    // Clean hint must NOT appear in this case.
    expect(text).not.toContain(ipDetailsMessages.hero.cleanHint);

    unmount();
  });

  test("hero and security section agree on crawler-only IPs (no clean-hint regression)", () => {
    // Regression: the hero previously ignored `is_crawler` when deciding
    // whether to show the "Clean — no signals" hint, while the security
    // section counted it towards `anyActive`. Result: green shield + chip
    // for the same IP. Both must now agree via `hasActiveThreatSignals`.
    const crawlerOnly: IpGeoLookupResponse = {
      status: "ok",
      data: {
        ...FULL_RESPONSE.data,
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
          is_crawler: true,
          is_threat: false,
          score: 0.02,
          risk_level: "low",
          blocklists: [],
        },
      },
    } as IpGeoLookupResponse;

    useIpGeoMocks.useIpGeo.mockReturnValue({
      data: crawlerOnly,
      isLoading: false,
      isError: false,
    });

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IpDetailsDialog ip="66.249.66.1" open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    );

    const text = allText();
    // Crawler chip/badge visible.
    expect(text).toContain(ipDetailsMessages.badges.crawler);
    // Hero must NOT advertise the IP as clean.
    expect(text).not.toContain(ipDetailsMessages.hero.cleanHint);

    unmount();
  });

  test("unknown risk level falls back to the 'unknown' bucket, not 'none'", () => {
    const weirdLevel: IpGeoLookupResponse = {
      status: "ok",
      data: {
        ...FULL_RESPONSE.data,
        threat: {
          ...FULL_RESPONSE.data.threat,
          // Simulate an upstream adding a new severity the frontend hasn't
          // learned about yet. Must not be styled as the safest state.
          risk_level: "extreme" as unknown as IpGeoLookupResult["threat"]["risk_level"],
          score: 0.95,
        },
      },
    } as IpGeoLookupResponse;

    useIpGeoMocks.useIpGeo.mockReturnValue({
      data: weirdLevel,
      isLoading: false,
      isError: false,
    });

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IpDetailsDialog ip="8.8.8.8" open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    );

    const text = allText();
    expect(text).toContain(ipDetailsMessages.riskLevels.unknown);
    expect(text).not.toContain(ipDetailsMessages.riskLevels.none);

    unmount();
  });
});
