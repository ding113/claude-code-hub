import { afterEach, describe, expect, it } from "vitest";
import { createCsrfOriginGuard } from "@/lib/security/csrf-origin-guard";

function createRequest(headers: Record<string, string>) {
  return {
    headers: new Headers(headers),
  };
}

describe("createCsrfOriginGuard", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("allows same-origin request when allowSameOrigin is enabled", () => {
    const guard = createCsrfOriginGuard({
      allowedOrigins: [],
      allowSameOrigin: true,
      enforceInDevelopment: true,
    });

    const result = guard.check(
      createRequest({
        "sec-fetch-site": "same-origin",
      })
    );

    expect(result).toEqual({ allowed: true });
  });

  it("allows request when Origin is in allowlist", () => {
    const origin = "https://example.com";
    const guard = createCsrfOriginGuard({
      allowedOrigins: [origin],
      allowSameOrigin: false,
      enforceInDevelopment: true,
    });

    const result = guard.check(
      createRequest({
        "sec-fetch-site": "cross-site",
        origin,
      })
    );

    expect(result).toEqual({ allowed: true });
  });

  it("blocks request when Origin is not in allowlist", () => {
    const guard = createCsrfOriginGuard({
      allowedOrigins: ["https://allowed.example.com"],
      allowSameOrigin: false,
      enforceInDevelopment: true,
    });

    const result = guard.check(
      createRequest({
        origin: "https://evil.example.com",
      })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Origin https://evil.example.com not in allowlist");
  });

  it("allows request without Origin header", () => {
    const guard = createCsrfOriginGuard({
      allowedOrigins: [],
      allowSameOrigin: true,
      enforceInDevelopment: true,
    });

    const result = guard.check(createRequest({}));

    expect(result).toEqual({ allowed: true });
  });

  it("blocks cross-site request when Origin header is missing", () => {
    const guard = createCsrfOriginGuard({
      allowedOrigins: ["https://example.com"],
      allowSameOrigin: true,
      enforceInDevelopment: true,
    });

    const result = guard.check(
      createRequest({
        "sec-fetch-site": "cross-site",
      })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Cross-site request blocked: missing Origin header");
  });

  it("bypasses guard in development when enforceInDevelopment is disabled", () => {
    process.env.NODE_ENV = "development";

    const guard = createCsrfOriginGuard({
      allowedOrigins: ["https://allowed.example.com"],
      allowSameOrigin: false,
      enforceInDevelopment: false,
    });

    const result = guard.check(
      createRequest({
        "sec-fetch-site": "cross-site",
        origin: "https://evil.example.com",
      })
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("csrf_guard_bypassed_in_development");
  });
});
