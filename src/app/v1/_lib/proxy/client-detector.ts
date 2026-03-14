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

export interface ClientRestrictionResult {
  allowed: boolean;
  matchType: "no_restriction" | "allowed" | "blocklist_hit" | "allowlist_miss";
  matchedPattern?: string;
  detectedClient?: string;
  checkedAllowlist: string[];
  checkedBlocklist: string[];
  signals?: string[];
  hubConfirmed?: boolean;
}

const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, "");

function matchesCodexDesktopAlias(pattern: string, userAgent: string): boolean {
  if (!/^codex desktop\b/i.test(userAgent)) {
    return false;
  }

  const normalizedPattern = pattern.trim().toLowerCase();
  return (
    normalizedPattern === "codex-cli" ||
    normalizedPattern === "codex_vscode" ||
    normalizedPattern === "codex desktop"
  );
}

function globMatch(pattern: string, text: string): boolean {
  const lp = pattern.toLowerCase();
  const lt = text.toLowerCase();
  let pi = 0;
  let ti = 0;
  let starPi = -1;
  let starTi = -1;
  while (ti < lt.length) {
    if (pi < lp.length && lp[pi] === lt[ti]) {
      pi++;
      ti++;
    } else if (pi < lp.length && lp[pi] === "*") {
      starPi = pi;
      starTi = ti;
      pi++;
    } else if (starPi >= 0) {
      pi = starPi + 1;
      starTi++;
      ti = starTi;
    } else {
      return false;
    }
  }
  while (pi < lp.length && lp[pi] === "*") pi++;
  return pi === lp.length;
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

  if (session.headers.has("anthropic-beta")) {
    signals.push("betas-present");
  }

  const metadata = session.request.message.metadata;
  if (
    metadata !== null &&
    typeof metadata === "object" &&
    "user_id" in metadata &&
    typeof (metadata as Record<string, unknown>).user_id === "string"
  ) {
    signals.push("metadata-user-id");
  }

  if (session.headers.get("anthropic-dangerous-direct-browser-access") === "true") {
    supplementary.push("dangerous-browser-access");
  }

  return {
    confirmed: signals.length === 4,
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
    const ua = session.userAgent?.trim();
    if (!ua) {
      return false;
    }

    if (matchesCodexDesktopAlias(pattern, ua)) {
      return true;
    }

    if (pattern.includes("*")) {
      return globMatch(pattern, ua);
    }

    const normalizedUa = normalize(ua);
    const normalizedPattern = normalize(pattern);
    if (normalizedPattern === "") {
      return false;
    }

    return normalizedUa.includes(normalizedPattern);
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
    const ua = session.userAgent?.trim();
    if (ua) {
      if (matchesCodexDesktopAlias(pattern, ua)) {
        matched = true;
      } else if (pattern.includes("*")) {
        matched = globMatch(pattern, ua);
      } else {
        const normalizedPattern = normalize(pattern);
        if (normalizedPattern !== "") {
          matched = normalize(ua).includes(normalizedPattern);
        }
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
  return isClientAllowedDetailed(session, allowedClients, blockedClients).allowed;
}

export function isClientAllowedDetailed(
  session: ProxySession,
  allowedClients: string[],
  blockedClients?: string[]
): ClientRestrictionResult {
  const checkedAllowlist = allowedClients;
  const checkedBlocklist = blockedClients ?? [];

  const hasBlockList = checkedBlocklist.length > 0;
  if (!hasBlockList && allowedClients.length === 0) {
    return {
      allowed: true,
      matchType: "no_restriction",
      checkedAllowlist,
      checkedBlocklist,
    };
  }

  // Pre-compute once to avoid repeated signal checks per pattern
  const claudeCode = confirmClaudeCodeSignals(session);
  const ua = session.userAgent?.trim() ?? "";
  const normalizedUa = normalize(ua);
  const subClient = claudeCode.confirmed ? extractSubClient(ua) : null;
  const detectedClient = subClient || ua || undefined;
  const hasBuiltinKeyword =
    checkedAllowlist.some(isBuiltinKeyword) || checkedBlocklist.some(isBuiltinKeyword);

  const matches = (pattern: string): boolean => {
    if (!isBuiltinKeyword(pattern)) {
      if (!ua) return false;
      if (matchesCodexDesktopAlias(pattern, ua)) {
        return true;
      }
      if (pattern.includes("*")) {
        return globMatch(pattern, ua);
      }
      const normalizedPattern = normalize(pattern);
      return normalizedPattern !== "" && normalizedUa.includes(normalizedPattern);
    }
    if (!claudeCode.confirmed) return false;
    if (pattern === CLAUDE_CODE_KEYWORD_PREFIX) return true;
    return subClient === pattern;
  };

  if (checkedBlocklist.length > 0) {
    const blockedPattern = checkedBlocklist.find(matches);
    if (blockedPattern) {
      return {
        allowed: false,
        matchType: "blocklist_hit",
        matchedPattern: blockedPattern,
        detectedClient,
        checkedAllowlist,
        checkedBlocklist,
        ...(hasBuiltinKeyword && {
          signals: claudeCode.signals,
          hubConfirmed: claudeCode.confirmed,
        }),
      };
    }
  }

  if (allowedClients.length === 0) {
    return {
      allowed: true,
      matchType: "allowed",
      detectedClient,
      checkedAllowlist,
      checkedBlocklist,
      ...(hasBuiltinKeyword && { signals: claudeCode.signals, hubConfirmed: claudeCode.confirmed }),
    };
  }

  const allowedPattern = allowedClients.find(matches);
  if (allowedPattern) {
    return {
      allowed: true,
      matchType: "allowed",
      matchedPattern: allowedPattern,
      detectedClient,
      checkedAllowlist,
      checkedBlocklist,
      ...(hasBuiltinKeyword && { signals: claudeCode.signals, hubConfirmed: claudeCode.confirmed }),
    };
  }

  return {
    allowed: false,
    matchType: "allowlist_miss",
    detectedClient,
    checkedAllowlist,
    checkedBlocklist,
    ...(hasBuiltinKeyword && { signals: claudeCode.signals, hubConfirmed: claudeCode.confirmed }),
  };
}
