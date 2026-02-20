import type { ProxySession } from "./session";

export const CLAUDE_CODE_KEYWORD_PREFIX = "claude-code";

export const BUILTIN_CLIENT_KEYWORDS = new Set([
  "claude-code",
  "claude-code-cli",
  "claude-code-cli-sdk",
  "claude-code-vscode",
  "claude-code-sdk-ts",
  "claude-code-sdk-py",
  "claude-code-gh-action",
]);

export interface ClientDetectionResult {
  matched: boolean;
  hubConfirmed: boolean;
  subClient: string | null;
  signals: string[];
  supplementary: string[];
}

const ENTRYPOINT_MAP: Record<string, string> = {
  cli: "claude-code-cli",
  "sdk-cli": "claude-code-cli-sdk",
  "claude-vscode": "claude-code-vscode",
  "sdk-ts": "claude-code-sdk-ts",
  "sdk-py": "claude-code-sdk-py",
  "claude-code-github-action": "claude-code-gh-action",
};

function confirmClaudeCodeSignals(session: ProxySession): {
  confirmed: boolean;
  signals: string[];
  supplementary: string[];
} {
  const signals: string[] = [];
  const supplementary: string[] = [];

  if (session.headers.get("x-app") === "cli") {
    signals.push("x-app-cli");
  }

  if (/^claude-cli\//i.test(session.userAgent ?? "")) {
    signals.push("ua-prefix");
  }

  const betas = (session.request.message as any).betas;
  if (
    Array.isArray(betas) &&
    betas.some((beta) => typeof beta === "string" && /^claude-code-/i.test(beta))
  ) {
    signals.push("betas-claude-code");
  }

  if (session.headers.get("anthropic-dangerous-direct-browser-access") === "true") {
    supplementary.push("dangerous-browser-access");
  }

  return {
    confirmed: signals.length === 3,
    signals,
    supplementary,
  };
}

function extractSubClient(ua: string): string | null {
  const match = /^claude-cli\/\S+\s+\(external,\s*([^,)]+)/i.exec(ua);
  if (!match?.[1]) {
    return null;
  }

  const entrypoint = match[1].trim();
  return ENTRYPOINT_MAP[entrypoint] ?? null;
}

export function isBuiltinKeyword(pattern: string): boolean {
  return BUILTIN_CLIENT_KEYWORDS.has(pattern);
}

export function matchClientPattern(session: ProxySession, pattern: string): boolean {
  if (!isBuiltinKeyword(pattern)) {
    const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, "");
    const ua = session.userAgent?.trim();
    if (!ua) {
      return false;
    }

    const normalizedPattern = normalize(pattern);
    if (normalizedPattern === "") {
      return false;
    }

    return normalize(ua).includes(normalizedPattern);
  }

  const claudeCode = confirmClaudeCodeSignals(session);
  if (!claudeCode.confirmed) {
    return false;
  }

  if (pattern === CLAUDE_CODE_KEYWORD_PREFIX) {
    return true;
  }

  const subClient = extractSubClient(session.userAgent ?? "");
  return subClient === pattern;
}

export function detectClientFull(session: ProxySession, pattern: string): ClientDetectionResult {
  const claudeCode = confirmClaudeCodeSignals(session);
  const subClient = claudeCode.confirmed ? extractSubClient(session.userAgent ?? "") : null;

  let matched = false;
  if (isBuiltinKeyword(pattern)) {
    if (claudeCode.confirmed) {
      matched =
        pattern === CLAUDE_CODE_KEYWORD_PREFIX || (subClient !== null && subClient === pattern);
    }
  } else {
    const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, "");
    const ua = session.userAgent?.trim();
    if (ua) {
      const normalizedPattern = normalize(pattern);
      if (normalizedPattern !== "") {
        matched = normalize(ua).includes(normalizedPattern);
      }
    }
  }

  return {
    matched,
    hubConfirmed: claudeCode.confirmed,
    subClient,
    signals: claudeCode.signals,
    supplementary: claudeCode.supplementary,
  };
}

export function isClientAllowed(
  session: ProxySession,
  allowedClients: string[],
  blockedClients?: string[]
): boolean {
  if (blockedClients && blockedClients.length > 0) {
    const isBlocked = blockedClients.some((pattern) => matchClientPattern(session, pattern));
    if (isBlocked) {
      return false;
    }
  }

  if (allowedClients.length === 0) {
    return true;
  }

  return allowedClients.some((pattern) => matchClientPattern(session, pattern));
}
