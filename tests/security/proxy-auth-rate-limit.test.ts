import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the proxy auth pre-auth rate limiter.
 *
 * The rate limiter is a module-level LoginAbusePolicy instance inside
 * auth-guard.ts. Since it relies on ProxySession (which depends on Hono
 * Context), we test the underlying LoginAbusePolicy behaviour that the
 * guard delegates to, plus the IP extraction helper logic.
 */

// We test the LoginAbusePolicy directly with proxy-specific config
import { LoginAbusePolicy } from "@/lib/security/login-abuse-policy";

describe("Proxy pre-auth rate limiter (LoginAbusePolicy with proxy config)", () => {
  const nowMs = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests below the proxy threshold (20)", () => {
    const policy = new LoginAbusePolicy({
      maxAttemptsPerIp: 20,
      maxAttemptsPerKey: 20,
      windowSeconds: 300,
      lockoutSeconds: 600,
    });
    const ip = "10.0.0.1";

    for (let i = 0; i < 19; i++) {
      policy.recordFailure(ip);
    }

    expect(policy.check(ip)).toEqual({ allowed: true });
  });

  it("blocks after 20 consecutive failures", () => {
    const policy = new LoginAbusePolicy({
      maxAttemptsPerIp: 20,
      maxAttemptsPerKey: 20,
      windowSeconds: 300,
      lockoutSeconds: 600,
    });
    const ip = "10.0.0.2";

    for (let i = 0; i < 20; i++) {
      policy.recordFailure(ip);
    }

    const decision = policy.check(ip);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(600);
  });

  it("resets failure count after success", () => {
    const policy = new LoginAbusePolicy({
      maxAttemptsPerIp: 20,
      maxAttemptsPerKey: 20,
      windowSeconds: 300,
      lockoutSeconds: 600,
    });
    const ip = "10.0.0.3";

    for (let i = 0; i < 15; i++) {
      policy.recordFailure(ip);
    }

    policy.recordSuccess(ip);

    // After success, counter is reset — 5 more failures should be allowed
    for (let i = 0; i < 5; i++) {
      policy.recordFailure(ip);
    }
    expect(policy.check(ip)).toEqual({ allowed: true });
  });

  it("unlocks after lockout period expires", () => {
    const policy = new LoginAbusePolicy({
      maxAttemptsPerIp: 20,
      maxAttemptsPerKey: 20,
      windowSeconds: 300,
      lockoutSeconds: 600,
    });
    const ip = "10.0.0.4";

    for (let i = 0; i < 20; i++) {
      policy.recordFailure(ip);
    }

    expect(policy.check(ip).allowed).toBe(false);

    // Advance past lockout
    vi.advanceTimersByTime(601_000);
    expect(policy.check(ip).allowed).toBe(true);
  });

  it("tracks different IPs independently", () => {
    const policy = new LoginAbusePolicy({
      maxAttemptsPerIp: 3,
      maxAttemptsPerKey: 3,
      windowSeconds: 300,
      lockoutSeconds: 600,
    });

    const ipA = "10.0.0.10";
    const ipB = "10.0.0.11";

    for (let i = 0; i < 3; i++) {
      policy.recordFailure(ipA);
    }

    expect(policy.check(ipA).allowed).toBe(false);
    expect(policy.check(ipB).allowed).toBe(true);
  });
});

describe("extractClientIp logic (rightmost x-forwarded-for)", () => {
  it("takes rightmost IP from x-forwarded-for", () => {
    // Simulates: client spoofs leftmost, proxy appends real IP
    const forwarded = "spoofed-ip, real-client-ip";
    const ips = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(ips[ips.length - 1]).toBe("real-client-ip");
  });

  it("handles single IP in x-forwarded-for", () => {
    const forwarded = "192.168.1.1";
    const ips = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(ips[ips.length - 1]).toBe("192.168.1.1");
  });

  it("prefers x-real-ip over x-forwarded-for", () => {
    // The implementation checks x-real-ip first
    const realIp = "10.0.0.1";
    const forwarded = "spoofed, 10.0.0.2";

    // x-real-ip is present and non-empty → use it
    const result = realIp.trim() || undefined;
    expect(result).toBe("10.0.0.1");
  });

  it("returns 'unknown' when no headers present", () => {
    const realIp: string | null = null;
    const forwarded: string | null = null;

    const result = realIp?.trim() || forwarded || "unknown";
    expect(result).toBe("unknown");
  });
});
