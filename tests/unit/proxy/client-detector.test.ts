import { describe, expect, test } from "vitest";
import {
  BUILTIN_CLIENT_KEYWORDS,
  CLAUDE_CODE_KEYWORD_PREFIX,
  detectClientFull,
  isBuiltinKeyword,
  isClientAllowed,
  isClientAllowedDetailed,
  matchClientPattern,
} from "@/app/v1/_lib/proxy/client-detector";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

type SessionOptions = {
  userAgent?: string | null;
  xApp?: string | null;
  dangerousBrowserAccess?: string | null;
  betas?: unknown;
};

function createMockSession(options: SessionOptions = {}): ProxySession {
  const headers = new Headers();
  if (options.xApp !== undefined && options.xApp !== null) {
    headers.set("x-app", options.xApp);
  }
  if (options.dangerousBrowserAccess !== undefined && options.dangerousBrowserAccess !== null) {
    headers.set("anthropic-dangerous-direct-browser-access", options.dangerousBrowserAccess);
  }

  const message: Record<string, unknown> = {};
  if ("betas" in options) {
    message.betas = options.betas;
  }

  return {
    userAgent: options.userAgent ?? null,
    headers,
    request: {
      message,
    },
  } as unknown as ProxySession;
}

function createConfirmedClaudeCodeSession(userAgent: string): ProxySession {
  return createMockSession({
    userAgent,
    xApp: "cli",
    betas: ["claude-code-test"],
  });
}

describe("client-detector", () => {
  describe("constants", () => {
    test("CLAUDE_CODE_KEYWORD_PREFIX should be claude-code", () => {
      expect(CLAUDE_CODE_KEYWORD_PREFIX).toBe("claude-code");
    });

    test("BUILTIN_CLIENT_KEYWORDS should contain 7 items", () => {
      expect(BUILTIN_CLIENT_KEYWORDS.size).toBe(7);
    });
  });

  describe("isBuiltinKeyword", () => {
    test.each([
      "claude-code",
      "claude-code-cli",
      "claude-code-cli-sdk",
      "claude-code-vscode",
      "claude-code-sdk-ts",
      "claude-code-sdk-py",
      "claude-code-gh-action",
    ])("should return true for builtin keyword: %s", (pattern) => {
      expect(isBuiltinKeyword(pattern)).toBe(true);
    });

    test.each([
      "gemini-cli",
      "codex-cli",
      "custom-pattern",
    ])("should return false for non-builtin keyword: %s", (pattern) => {
      expect(isBuiltinKeyword(pattern)).toBe(false);
    });
  });

  describe("confirmClaudeCodeSignals via detectClientFull", () => {
    test("should confirm when all 3 strong signals are present", () => {
      const session = createMockSession({
        userAgent: "claude-cli/1.0.0 (external, cli)",
        xApp: "cli",
        betas: ["claude-code-cache-control-20260101"],
      });

      const result = detectClientFull(session, "claude-code");
      expect(result.hubConfirmed).toBe(true);
      expect(result.signals).toEqual(["x-app-cli", "ua-prefix", "betas-claude-code"]);
      expect(result.supplementary).toEqual([]);
    });

    test.each([
      {
        name: "missing x-app",
        options: {
          userAgent: "claude-cli/1.0.0 (external, cli)",
          betas: ["claude-code-foo"],
        },
      },
      {
        name: "missing ua-prefix",
        options: {
          userAgent: "GeminiCLI/1.0",
          xApp: "cli",
          betas: ["claude-code-foo"],
        },
      },
      {
        name: "missing betas-claude-code",
        options: {
          userAgent: "claude-cli/1.0.0 (external, cli)",
          xApp: "cli",
          betas: ["not-claude-code"],
        },
      },
    ])("should not confirm with only 2-of-3 signals: $name", ({ options }) => {
      const session = createMockSession(options);
      const result = detectClientFull(session, "claude-code");
      expect(result.hubConfirmed).toBe(false);
      expect(result.signals.length).toBe(2);
    });

    test("should not confirm with 0 strong signals", () => {
      const session = createMockSession({ userAgent: "GeminiCLI/1.0", betas: "not-array" });
      const result = detectClientFull(session, "claude-code");

      expect(result.hubConfirmed).toBe(false);
      expect(result.signals).toEqual([]);
    });

    test("should collect supplementary signal without counting it", () => {
      const session = createMockSession({
        userAgent: "claude-cli/1.0.0 (external, cli)",
        xApp: "cli",
        betas: ["not-claude-code"],
        dangerousBrowserAccess: "true",
      });

      const result = detectClientFull(session, "claude-code");
      expect(result.hubConfirmed).toBe(false);
      expect(result.signals).toEqual(["x-app-cli", "ua-prefix"]);
      expect(result.supplementary).toEqual(["dangerous-browser-access"]);
    });
  });

  describe("extractSubClient via detectClientFull", () => {
    test.each([
      ["cli", "claude-code-cli"],
      ["sdk-cli", "claude-code-cli-sdk"],
      ["claude-vscode", "claude-code-vscode"],
      ["sdk-ts", "claude-code-sdk-ts"],
      ["sdk-py", "claude-code-sdk-py"],
      ["claude-code-github-action", "claude-code-gh-action"],
    ])("should map entrypoint %s to %s", (entrypoint, expectedSubClient) => {
      const session = createConfirmedClaudeCodeSession(
        `claude-cli/1.2.3 (external, ${entrypoint})`
      );
      const result = detectClientFull(session, "claude-code");

      expect(result.hubConfirmed).toBe(true);
      expect(result.subClient).toBe(expectedSubClient);
    });

    test("should return null for unknown entrypoint", () => {
      const session = createConfirmedClaudeCodeSession(
        "claude-cli/1.2.3 (external, unknown-entry)"
      );
      const result = detectClientFull(session, "claude-code");

      expect(result.hubConfirmed).toBe(true);
      expect(result.subClient).toBeNull();
    });

    test("should return null for malformed UA", () => {
      const session = createConfirmedClaudeCodeSession("claude-cli 1.2.3 (external, cli)");
      const result = detectClientFull(session, "claude-code");

      expect(result.hubConfirmed).toBe(false);
      expect(result.subClient).toBeNull();
    });

    test("should return null when UA has no parentheses section", () => {
      const session = createMockSession({
        userAgent: "claude-cli/1.2.3 external, cli",
        xApp: "cli",
        betas: ["claude-code-a"],
      });
      const result = detectClientFull(session, "claude-code");

      expect(result.hubConfirmed).toBe(true);
      expect(result.subClient).toBeNull();
    });
  });

  describe("matchClientPattern builtin keyword path", () => {
    test("should match wildcard claude-code when 3-of-3 is confirmed", () => {
      const session = createConfirmedClaudeCodeSession("claude-cli/1.2.3 (external, cli)");
      expect(matchClientPattern(session, "claude-code")).toBe(true);
    });

    test("should match claude-code-cli for cli entrypoint", () => {
      const session = createConfirmedClaudeCodeSession("claude-cli/1.2.3 (external, cli)");
      expect(matchClientPattern(session, "claude-code-cli")).toBe(true);
    });

    test("should match claude-code-vscode for claude-vscode entrypoint", () => {
      const session = createConfirmedClaudeCodeSession(
        "claude-cli/1.2.3 (external, claude-vscode, agent-sdk/0.1.0)"
      );
      expect(matchClientPattern(session, "claude-code-vscode")).toBe(true);
    });

    test("should return false when sub-client does not match", () => {
      const session = createConfirmedClaudeCodeSession("claude-cli/1.2.3 (external, sdk-py)");
      expect(matchClientPattern(session, "claude-code-sdk-ts")).toBe(false);
    });

    test("should return false when only 2-of-3 signals are present", () => {
      const session = createMockSession({
        userAgent: "claude-cli/1.2.3 (external, cli)",
        xApp: "cli",
        betas: ["non-claude-code"],
      });
      expect(matchClientPattern(session, "claude-code")).toBe(false);
    });
  });

  describe("matchClientPattern custom substring path", () => {
    test("should match gemini-cli against GeminiCLI", () => {
      const session = createMockSession({ userAgent: "GeminiCLI/1.0" });
      expect(matchClientPattern(session, "gemini-cli")).toBe(true);
    });

    test("should match codex-cli against codex_cli", () => {
      const session = createMockSession({ userAgent: "codex_cli/2.0" });
      expect(matchClientPattern(session, "codex-cli")).toBe(true);
    });

    test("should return false when User-Agent is empty", () => {
      const session = createMockSession({ userAgent: "   " });
      expect(matchClientPattern(session, "gemini-cli")).toBe(false);
    });

    test("should return false when custom pattern is not found", () => {
      const session = createMockSession({ userAgent: "Mozilla/5.0 Compatible" });
      expect(matchClientPattern(session, "gemini-cli")).toBe(false);
    });

    test("should return false when pattern normalizes to empty", () => {
      const session = createMockSession({ userAgent: "AnyClient/1.0" });
      expect(matchClientPattern(session, "-_-")).toBe(false);
    });
  });

  describe("isClientAllowed", () => {
    test("should reject when blocked matches even if allowed also matches", () => {
      const session = createConfirmedClaudeCodeSession("claude-cli/1.2.3 (external, cli)");
      expect(isClientAllowed(session, ["claude-code"], ["claude-code"])).toBe(false);
    });

    test("should allow when allowedClients and blockedClients are both empty", () => {
      const session = createMockSession({ userAgent: "AnyClient/1.0" });
      expect(isClientAllowed(session, [], [])).toBe(true);
    });

    test("should allow when allowedClients match", () => {
      const session = createMockSession({ userAgent: "GeminiCLI/1.0" });
      expect(isClientAllowed(session, ["gemini-cli"])).toBe(true);
    });

    test("should reject when allowedClients are set but none match", () => {
      const session = createMockSession({ userAgent: "UnknownClient/1.0" });
      expect(isClientAllowed(session, ["gemini-cli"])).toBe(false);
    });

    test("should reject when only blockedClients are set and blocked matches", () => {
      const session = createMockSession({ userAgent: "GeminiCLI/1.0" });
      expect(isClientAllowed(session, [], ["gemini-cli"])).toBe(false);
    });

    test("should allow when only blockedClients are set and blocked does not match", () => {
      const session = createMockSession({ userAgent: "GeminiCLI/1.0" });
      expect(isClientAllowed(session, [], ["codex-cli"])).toBe(true);
    });

    test("should allow when blocked does not match and allowed matches", () => {
      const session = createMockSession({ userAgent: "codex_cli/2.0" });
      expect(isClientAllowed(session, ["codex-cli"], ["gemini-cli"])).toBe(true);
    });
  });

  describe("isClientAllowedDetailed", () => {
    test("should return no_restriction when both lists are empty", () => {
      const session = createMockSession({ userAgent: "AnyClient/1.0" });
      const result = isClientAllowedDetailed(session, [], []);
      expect(result).toEqual({
        allowed: true,
        matchType: "no_restriction",
        matchedPattern: undefined,
        detectedClient: undefined,
        checkedAllowlist: [],
        checkedBlocklist: [],
      });
    });

    test("should return blocklist_hit with matched pattern", () => {
      const session = createMockSession({ userAgent: "GeminiCLI/1.0" });
      const result = isClientAllowedDetailed(session, [], ["gemini-cli"]);
      expect(result.allowed).toBe(false);
      expect(result.matchType).toBe("blocklist_hit");
      expect(result.matchedPattern).toBe("gemini-cli");
      expect(result.detectedClient).toBe("GeminiCLI/1.0");
      expect(result.checkedBlocklist).toEqual(["gemini-cli"]);
    });

    test("should return allowlist_miss when no allowlist pattern matches", () => {
      const session = createMockSession({ userAgent: "UnknownClient/1.0" });
      const result = isClientAllowedDetailed(session, ["gemini-cli", "codex-cli"], []);
      expect(result.allowed).toBe(false);
      expect(result.matchType).toBe("allowlist_miss");
      expect(result.matchedPattern).toBeUndefined();
      expect(result.detectedClient).toBe("UnknownClient/1.0");
      expect(result.checkedAllowlist).toEqual(["gemini-cli", "codex-cli"]);
    });

    test("should return allowed when allowlist matches", () => {
      const session = createMockSession({ userAgent: "GeminiCLI/1.0" });
      const result = isClientAllowedDetailed(session, ["gemini-cli"], []);
      expect(result.allowed).toBe(true);
      expect(result.matchType).toBe("allowed");
      expect(result.matchedPattern).toBe("gemini-cli");
      expect(result.detectedClient).toBe("GeminiCLI/1.0");
    });

    test("blocklist takes precedence over allowlist", () => {
      const session = createConfirmedClaudeCodeSession("claude-cli/1.2.3 (external, cli)");
      const result = isClientAllowedDetailed(session, ["claude-code"], ["claude-code"]);
      expect(result.allowed).toBe(false);
      expect(result.matchType).toBe("blocklist_hit");
      expect(result.matchedPattern).toBe("claude-code");
    });

    test("should detect sub-client for builtin keywords", () => {
      const session = createConfirmedClaudeCodeSession("claude-cli/1.2.3 (external, sdk-ts)");
      const result = isClientAllowedDetailed(session, ["claude-code"], []);
      expect(result.allowed).toBe(true);
      expect(result.matchType).toBe("allowed");
      expect(result.detectedClient).toBe("claude-code-sdk-ts");
      expect(result.matchedPattern).toBe("claude-code");
    });

    test("should return allowed when only blocklist set and no match", () => {
      const session = createMockSession({ userAgent: "CodexCLI/1.0" });
      const result = isClientAllowedDetailed(session, [], ["gemini-cli"]);
      expect(result.allowed).toBe(true);
      expect(result.matchType).toBe("allowed");
      expect(result.detectedClient).toBe("CodexCLI/1.0");
    });

    test("should return no_restriction when blockedClients is undefined and allowlist empty", () => {
      const session = createMockSession({ userAgent: "AnyClient/1.0" });
      const result = isClientAllowedDetailed(session, []);
      expect(result.allowed).toBe(true);
      expect(result.matchType).toBe("no_restriction");
    });

    test("should capture first matching blocked pattern", () => {
      const session = createMockSession({ userAgent: "GeminiCLI/1.0" });
      const result = isClientAllowedDetailed(
        session,
        [],
        ["codex-cli", "gemini-cli", "factory-cli"]
      );
      expect(result.allowed).toBe(false);
      expect(result.matchType).toBe("blocklist_hit");
      expect(result.matchedPattern).toBe("gemini-cli");
    });
  });

  describe("detectClientFull", () => {
    test("should return matched=true for confirmed claude-code wildcard", () => {
      const session = createConfirmedClaudeCodeSession("claude-cli/1.2.3 (external, sdk-ts)");
      const result = detectClientFull(session, "claude-code");

      expect(result).toEqual({
        matched: true,
        hubConfirmed: true,
        subClient: "claude-code-sdk-ts",
        signals: ["x-app-cli", "ua-prefix", "betas-claude-code"],
        supplementary: [],
      });
    });

    test("should return matched=false for confirmed but different builtin sub-client", () => {
      const session = createConfirmedClaudeCodeSession("claude-cli/1.2.3 (external, sdk-ts)");
      const result = detectClientFull(session, "claude-code-cli");

      expect(result.hubConfirmed).toBe(true);
      expect(result.subClient).toBe("claude-code-sdk-ts");
      expect(result.matched).toBe(false);
    });

    test("should use custom normalization path for non-builtin patterns", () => {
      const session = createMockSession({ userAgent: "GeminiCLI/0.22.5" });
      const result = detectClientFull(session, "gemini-cli");

      expect(result.matched).toBe(true);
      expect(result.hubConfirmed).toBe(false);
      expect(result.subClient).toBeNull();
    });

    test("should return matched=false for custom pattern when User-Agent is missing", () => {
      const session = createMockSession({ userAgent: null });
      const result = detectClientFull(session, "gemini-cli");

      expect(result.matched).toBe(false);
      expect(result.hubConfirmed).toBe(false);
      expect(result.signals).toEqual([]);
      expect(result.supplementary).toEqual([]);
    });
  });
});
