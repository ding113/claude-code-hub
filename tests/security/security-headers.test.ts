import { describe, expect, test } from "vitest";
import {
  buildSecurityHeaders,
  DEFAULT_SECURITY_HEADERS_CONFIG,
} from "../../src/lib/security/security-headers";

describe("buildSecurityHeaders", () => {
  test("默认配置应生成预期安全头", () => {
    const headers = buildSecurityHeaders();

    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe(DEFAULT_SECURITY_HEADERS_CONFIG.frameOptions);
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["X-DNS-Prefetch-Control"]).toBe("off");
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["Content-Security-Policy-Report-Only"]).toContain("default-src 'self'");
  });

  test("enableHsts=true 时应包含 HSTS 头", () => {
    const headers = buildSecurityHeaders({ enableHsts: true });

    expect(headers["Strict-Transport-Security"]).toBe(
      `max-age=${DEFAULT_SECURITY_HEADERS_CONFIG.hstsMaxAge}; includeSubDomains`
    );
  });

  test("enableHsts=false 时不应包含 HSTS 头", () => {
    const headers = buildSecurityHeaders({ enableHsts: false });

    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  test("CSP report-only 模式应使用 Report-Only 头", () => {
    const headers = buildSecurityHeaders({ cspMode: "report-only" });

    expect(headers["Content-Security-Policy-Report-Only"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toBeUndefined();
  });

  test("CSP enforce 模式应使用强制策略头", () => {
    const headers = buildSecurityHeaders({ cspMode: "enforce" });

    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  test("CSP disabled 模式不应输出任何 CSP 头", () => {
    const headers = buildSecurityHeaders({ cspMode: "disabled" });

    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  test("X-Content-Type-Options 始终为 nosniff", () => {
    const defaultHeaders = buildSecurityHeaders();
    const disabledCspHeaders = buildSecurityHeaders({ cspMode: "disabled" });
    const enforceCspHeaders = buildSecurityHeaders({ cspMode: "enforce", enableHsts: true });

    expect(defaultHeaders["X-Content-Type-Options"]).toBe("nosniff");
    expect(disabledCspHeaders["X-Content-Type-Options"]).toBe("nosniff");
    expect(enforceCspHeaders["X-Content-Type-Options"]).toBe("nosniff");
  });

  test("X-Frame-Options 应与配置一致", () => {
    const denyHeaders = buildSecurityHeaders({ frameOptions: "DENY" });
    const sameOriginHeaders = buildSecurityHeaders({ frameOptions: "SAMEORIGIN" });

    expect(denyHeaders["X-Frame-Options"]).toBe("DENY");
    expect(sameOriginHeaders["X-Frame-Options"]).toBe("SAMEORIGIN");
  });

  test("cspReportUri with valid URL appends report-uri directive", () => {
    const headers = buildSecurityHeaders({
      cspMode: "report-only",
      cspReportUri: "https://csp.example.com/report",
    });

    expect(headers["Content-Security-Policy-Report-Only"]).toContain(
      "; report-uri https://csp.example.com/report"
    );
  });

  test("cspReportUri with semicolons is rejected to prevent directive injection", () => {
    const headers = buildSecurityHeaders({
      cspMode: "enforce",
      cspReportUri: "https://evil.com; script-src 'unsafe-eval'",
    });

    expect(headers["Content-Security-Policy"]).not.toContain("report-uri");
    expect(headers["Content-Security-Policy"]).not.toContain("evil.com");
  });

  test("cspReportUri with non-URL value is rejected", () => {
    const headers = buildSecurityHeaders({
      cspMode: "enforce",
      cspReportUri: "not a url",
    });

    expect(headers["Content-Security-Policy"]).not.toContain("report-uri");
  });

  test("cspReportUri with empty string is rejected", () => {
    const headers = buildSecurityHeaders({
      cspMode: "enforce",
      cspReportUri: "",
    });

    expect(headers["Content-Security-Policy"]).not.toContain("report-uri");
  });
});
