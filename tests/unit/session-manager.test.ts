import { afterEach, describe, expect, test, vi } from "vitest";

const ORIGINAL_SESSION_TTL = process.env.SESSION_TTL;

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("SessionManager.resolveSessionTtl", () => {
  afterEach(() => {
    if (ORIGINAL_SESSION_TTL === undefined) {
      delete process.env.SESSION_TTL;
    } else {
      process.env.SESSION_TTL = ORIGINAL_SESSION_TTL;
    }
  });

  async function importSessionManager() {
    vi.resetModules();
    const { SessionManager } = await import("../../src/lib/session-manager");
    return SessionManager;
  }

  test("falls back to global SESSION_TTL when provider ttl is null", async () => {
    process.env.SESSION_TTL = "600";
    const SessionManager = await importSessionManager();

    expect(SessionManager.resolveSessionTtl(null)).toBe(600);
    expect(SessionManager.resolveSessionTtl(undefined)).toBe(600);
  });

  test("clamps ttl to supported range", async () => {
    process.env.SESSION_TTL = "300";
    const SessionManager = await importSessionManager();

    expect(SessionManager.resolveSessionTtl(10)).toBe(60);
    expect(SessionManager.resolveSessionTtl(60)).toBe(60);
    expect(SessionManager.resolveSessionTtl(3600)).toBe(3600);
    expect(SessionManager.resolveSessionTtl(9999)).toBe(3600);
  });

  test("uses 300 when global SESSION_TTL is invalid", async () => {
    process.env.SESSION_TTL = "not-a-number";
    const SessionManager = await importSessionManager();

    expect(SessionManager.resolveSessionTtl(null)).toBe(300);
  });
});
