/**
 * @vitest-environment happy-dom
 */

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { IpGeoLookupResponse } from "@/types/ip-geo";
import ipDetailsMessages from "../../../../../messages/en/ipDetails.json";

const useIpGeoMocks = vi.hoisted(() => ({
  useIpGeo: vi.fn<(ip: string | null | undefined) => {
    data?: IpGeoLookupResponse;
    isLoading: boolean;
    isError: boolean;
  }>(),
}));
vi.mock("@/hooks/use-ip-geo", () => useIpGeoMocks);

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
    expect(
      hasMeaningfulCoordinates({ latitude: 0, longitude: 0, accuracy_radius_km: null })
    ).toBe(false);

    // Even a non-zero pair with null accuracy is untrusted — `null` means
    // "we don't know", not "exact".
    expect(
      hasMeaningfulCoordinates({ latitude: 37.4, longitude: -122.07, accuracy_radius_km: null })
    ).toBe(false);
  });

  test("returns false for the 0,0 null-island fallback", () => {
    expect(
      hasMeaningfulCoordinates({ latitude: 0, longitude: 0, accuracy_radius_km: 100 })
    ).toBe(false);
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
});
