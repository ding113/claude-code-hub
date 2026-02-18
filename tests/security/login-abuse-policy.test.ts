import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginAbusePolicy } from "@/lib/security/login-abuse-policy";

describe("LoginAbusePolicy", () => {
  const nowMs = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under threshold", () => {
    const policy = new LoginAbusePolicy({ maxAttemptsPerIp: 3 });
    const ip = "192.168.0.1";

    expect(policy.check(ip)).toEqual({ allowed: true });
    policy.recordFailure(ip);
    expect(policy.check(ip)).toEqual({ allowed: true });
    policy.recordFailure(ip);
    expect(policy.check(ip)).toEqual({ allowed: true });
  });

  it("blocks after maxAttemptsPerIp failures", () => {
    const policy = new LoginAbusePolicy({ maxAttemptsPerIp: 3, lockoutSeconds: 60 });
    const ip = "192.168.0.2";

    policy.recordFailure(ip);
    policy.recordFailure(ip);
    policy.recordFailure(ip);

    const decision = policy.check(ip);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("ip_rate_limited");
  });

  it("returns retryAfterSeconds when blocked", () => {
    const policy = new LoginAbusePolicy({ maxAttemptsPerIp: 1, lockoutSeconds: 90 });
    const ip = "192.168.0.3";

    policy.recordFailure(ip);

    const decision = policy.check(ip);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(90);
  });

  it("lockout remains active even after window expires", () => {
    const policy = new LoginAbusePolicy({
      maxAttemptsPerIp: 1,
      windowSeconds: 5,
      lockoutSeconds: 20,
    });
    const ip = "192.168.0.33";

    policy.recordFailure(ip);
    vi.advanceTimersByTime(6_000);

    const decision = policy.check(ip);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("ip_rate_limited");
    expect(decision.retryAfterSeconds).toBe(14);
  });

  it("recordSuccess resets the counter", () => {
    const policy = new LoginAbusePolicy({ maxAttemptsPerIp: 2, lockoutSeconds: 60 });
    const ip = "192.168.0.4";

    policy.recordFailure(ip);
    policy.recordFailure(ip);
    expect(policy.check(ip).allowed).toBe(false);

    policy.recordSuccess(ip);

    expect(policy.check(ip)).toEqual({ allowed: true });
  });

  it("expired window resets automatically", () => {
    const policy = new LoginAbusePolicy({
      maxAttemptsPerIp: 2,
      windowSeconds: 10,
      lockoutSeconds: 60,
    });
    const ip = "192.168.0.5";

    policy.recordFailure(ip);
    vi.advanceTimersByTime(11_000);

    policy.recordFailure(ip);
    expect(policy.check(ip)).toEqual({ allowed: true });
  });

  it("custom config overrides defaults", () => {
    const policy = new LoginAbusePolicy({
      maxAttemptsPerIp: 1,
      maxAttemptsPerKey: 2,
      windowSeconds: 30,
      lockoutSeconds: 120,
    });
    const ip = "192.168.0.6";

    policy.recordFailure(ip);

    const decision = policy.check(ip);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(120);
  });

  it("tracks different IPs independently", () => {
    const policy = new LoginAbusePolicy({ maxAttemptsPerIp: 1, lockoutSeconds: 60 });
    const blockedIp = "10.0.0.1";
    const allowedIp = "10.0.0.2";

    policy.recordFailure(blockedIp);

    expect(policy.check(blockedIp).allowed).toBe(false);
    expect(policy.check(allowedIp)).toEqual({ allowed: true });
  });

  it("supports key-based throttling with separate threshold", () => {
    const policy = new LoginAbusePolicy({
      maxAttemptsPerIp: 10,
      maxAttemptsPerKey: 2,
      lockoutSeconds: 60,
    });

    policy.recordFailure("10.0.0.10", "user@example.com");
    policy.recordFailure("10.0.0.11", "user@example.com");

    const blockedByKey = policy.check("10.0.0.12", "user@example.com");
    expect(blockedByKey.allowed).toBe(false);
    expect(blockedByKey.reason).toBe("key_rate_limited");

    expect(policy.check("10.0.0.10", "other@example.com")).toEqual({ allowed: true });
  });

  it("sweeps stale entries to prevent unbounded memory growth", () => {
    const policy = new LoginAbusePolicy({
      maxAttemptsPerIp: 2,
      windowSeconds: 5,
      lockoutSeconds: 10,
    });

    for (let i = 0; i < 100; i++) {
      policy.recordFailure(`10.0.${Math.floor(i / 256)}.${i % 256}`);
    }

    vi.advanceTimersByTime(61_000);

    policy.check("10.0.99.99");

    for (let i = 0; i < 100; i++) {
      const ip = `10.0.${Math.floor(i / 256)}.${i % 256}`;
      expect(policy.check(ip)).toEqual({ allowed: true });
    }
  });
});
