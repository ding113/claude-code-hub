import { describe, expect, test, vi, beforeEach } from "vitest";
import { ProxyClientGuard } from "@/app/v1/_lib/proxy/client-guard";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

// Mock ProxyResponses
vi.mock("@/app/v1/_lib/proxy/responses", () => ({
  ProxyResponses: {
    buildError: (status: number, message: string, code: string) =>
      new Response(JSON.stringify({ error: { message, type: code } }), { status }),
  },
}));

// Helper to create mock session
function createMockSession(
  userAgent: string | undefined,
  allowedClients: string[] = []
): ProxySession {
  return {
    userAgent,
    authState: {
      user: {
        allowedClients,
      },
    },
  } as unknown as ProxySession;
}

describe("ProxyClientGuard", () => {
  describe("when authState is missing", () => {
    test("should allow request when authState is undefined", async () => {
      const session = { userAgent: "SomeClient/1.0" } as unknown as ProxySession;
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });

    test("should allow request when authState.user is undefined", async () => {
      const session = {
        userAgent: "SomeClient/1.0",
        authState: {},
      } as unknown as ProxySession;
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });
  });

  describe("when no restrictions configured", () => {
    test("should allow request when allowedClients is empty", async () => {
      const session = createMockSession("AnyClient/1.0", []);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });

    test("should allow request when allowedClients is undefined", async () => {
      const session = createMockSession("AnyClient/1.0", undefined as unknown as string[]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });
  });

  describe("when restrictions are configured", () => {
    test("should reject when User-Agent is missing", async () => {
      const session = createMockSession(undefined, ["claude-cli"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(400);
    });

    test("should reject when User-Agent is empty", async () => {
      const session = createMockSession("", ["claude-cli"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(400);
    });

    test("should reject when User-Agent is whitespace only", async () => {
      const session = createMockSession("   ", ["claude-cli"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(400);
    });
  });

  describe("pattern matching with hyphen/underscore normalization", () => {
    test("should match gemini-cli pattern against GeminiCLI User-Agent", async () => {
      const session = createMockSession("GeminiCLI/0.22.5/gemini-3-pro-preview (darwin; arm64)", [
        "gemini-cli",
      ]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });

    test("should match claude-cli pattern against claude_cli User-Agent", async () => {
      const session = createMockSession("claude_cli/1.0", ["claude-cli"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });

    test("should match codex-cli pattern against codexcli User-Agent", async () => {
      const session = createMockSession("codexcli/2.0", ["codex-cli"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });

    test("should match factory-cli pattern against FactoryCLI User-Agent", async () => {
      const session = createMockSession("FactoryCLI/1.0", ["factory-cli"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });

    test("should be case-insensitive", async () => {
      const session = createMockSession("GEMINICLI/1.0", ["gemini-cli"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });
  });

  describe("pattern matching without normalization needed", () => {
    test("should match exact substring", async () => {
      const session = createMockSession("claude-cli/1.0.0", ["claude-cli"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });

    test("should match when User-Agent contains pattern as substring", async () => {
      const session = createMockSession("Mozilla/5.0 claude-cli/1.0 Compatible", ["claude-cli"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });
  });

  describe("multiple patterns", () => {
    test("should allow when one of multiple patterns matches", async () => {
      const session = createMockSession("GeminiCLI/1.0", ["claude-cli", "gemini-cli", "codex-cli"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });

    test("should reject when no patterns match", async () => {
      const session = createMockSession("UnknownClient/1.0", ["claude-cli", "gemini-cli"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(400);
    });
  });

  describe("edge cases", () => {
    test("should handle pattern with multiple hyphens", async () => {
      const session = createMockSession("my-special-cli/1.0", ["my-special-cli"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });

    test("should handle pattern with underscores", async () => {
      const session = createMockSession("my_special_cli/1.0", ["my-special-cli"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });

    test("should handle mixed hyphen and underscore", async () => {
      const session = createMockSession("my_special-cli/1.0", ["my-special_cli"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });

    test("should reject when pattern normalizes to empty string", async () => {
      const session = createMockSession("AnyClient/1.0", ["-"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(400);
    });

    test("should reject when pattern is only underscores", async () => {
      const session = createMockSession("AnyClient/1.0", ["___"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(400);
    });

    test("should reject when pattern is only hyphens and underscores", async () => {
      const session = createMockSession("AnyClient/1.0", ["-_-_-"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(400);
    });

    test("should reject when all patterns normalize to empty", async () => {
      const session = createMockSession("AnyClient/1.0", ["-", "_", "--"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(400);
    });

    test("should allow when at least one pattern is valid after normalization", async () => {
      const session = createMockSession("ValidClient/1.0", ["-", "valid", "_"]);
      const result = await ProxyClientGuard.ensure(session);
      expect(result).toBeNull();
    });
  });
});
