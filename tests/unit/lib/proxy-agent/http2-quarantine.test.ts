import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHttp2TransportQuarantine,
  getHttp2TransportKey,
  isHttp2TransportQuarantined,
  quarantineHttp2Transport,
} from "@/lib/proxy-agent/http2-quarantine";

describe("HTTP/2 transport quarantine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearHttp2TransportQuarantine();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps target and proxy origins isolated without retaining credentials", () => {
    const key = getHttp2TransportKey({
      targetUrl: "https://co.yes.vg/team/v1/responses?token=secret",
      proxyUrl: "https://user:password@proxy.example.com:8443/path",
    });

    expect(key).toBe("https://co.yes.vg|https://proxy.example.com:8443");
    expect(key).not.toContain("secret");
    expect(key).not.toContain("password");
  });

  it("quarantines an origin and expires it after the bounded TTL", () => {
    const route = { targetUrl: "https://co.yes.vg/team/v1/responses", proxyUrl: null };

    expect(isHttp2TransportQuarantined(route)).toBe(false);
    quarantineHttp2Transport(route);
    expect(isHttp2TransportQuarantined(route)).toBe(true);

    vi.advanceTimersByTime(5 * 60 * 1000 - 1);
    expect(isHttp2TransportQuarantined(route)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isHttp2TransportQuarantined(route)).toBe(false);
  });

  it("does not quarantine a different target or proxy origin", () => {
    const route = { targetUrl: "https://co.yes.vg/team/v1/responses", proxyUrl: null };
    quarantineHttp2Transport(route);

    expect(
      isHttp2TransportQuarantined({ targetUrl: "https://other.example.com/v1/responses" })
    ).toBe(false);
    expect(
      isHttp2TransportQuarantined({
        targetUrl: route.targetUrl,
        proxyUrl: "https://proxy.example.com",
      })
    ).toBe(false);
  });

  it("bounds retained route state when many origins fail", () => {
    for (let index = 0; index < 1_100; index += 1) {
      quarantineHttp2Transport({ targetUrl: `https://provider-${index}.example.com/v1` });
    }

    expect(isHttp2TransportQuarantined({ targetUrl: "https://provider-1099.example.com/v1" })).toBe(
      true
    );
    expect(isHttp2TransportQuarantined({ targetUrl: "https://provider-0.example.com/v1" })).toBe(
      false
    );
  });
});
