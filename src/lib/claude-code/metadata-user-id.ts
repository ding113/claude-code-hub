import crypto from "node:crypto";
import { parseUserAgent } from "@/lib/ua-parser";
import { isVersionLess } from "@/lib/version";

export const CLAUDE_CODE_METADATA_USER_ID_JSON_SWITCH_VERSION = "2.1.78";

export type ClaudeMetadataUserIdFormat = "legacy" | "json";

export type ClaudeMetadataUserIdParseResult = {
  sessionId: string | null;
  format: ClaudeMetadataUserIdFormat | null;
  deviceId: string | null;
  accountUuid: string | null;
};

type BuildClaudeMetadataUserIdArgs = {
  keyId: number;
  sessionId: string;
  userAgent?: string | null;
};

type InjectClaudeMetadataUserIdArgs = {
  keyId: number | null | undefined;
  sessionId: string | null | undefined;
  userAgent?: string | null;
};

const LEGACY_PATTERN = /^user_(.+?)_account__session_(.+)$/;
const CLAUDE_CODE_CLIENT_TYPES = new Set(["claude-cli", "claude-vscode", "claude-cli-unknown"]);

function emptyParseResult(): ClaudeMetadataUserIdParseResult {
  return {
    sessionId: null,
    format: null,
    deviceId: null,
    accountUuid: null,
  };
}

export function buildClaudeMetadataDeviceId(keyId: number): string {
  return crypto.createHash("sha256").update(`claude_user_${keyId}`).digest("hex");
}

export function hasUsableClaudeMetadataUserId(userId: unknown): boolean {
  if (typeof userId === "string") {
    return userId.trim().length > 0;
  }

  return userId !== undefined && userId !== null;
}

export function resolveClaudeMetadataUserIdFormat(
  userAgent?: string | null
): ClaudeMetadataUserIdFormat {
  const clientInfo = parseUserAgent(userAgent);
  if (!clientInfo || !CLAUDE_CODE_CLIENT_TYPES.has(clientInfo.clientType)) {
    return "json";
  }

  return isVersionLess(clientInfo.version, CLAUDE_CODE_METADATA_USER_ID_JSON_SWITCH_VERSION)
    ? "legacy"
    : "json";
}

export function parseClaudeMetadataUserId(userId: unknown): ClaudeMetadataUserIdParseResult {
  if (typeof userId !== "string") {
    return emptyParseResult();
  }

  const trimmed = userId.trim();
  if (!trimmed) {
    return emptyParseResult();
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const parsedObj = parsed as Record<string, unknown>;
      const sessionId =
        typeof parsedObj.session_id === "string" ? parsedObj.session_id.trim() : null;

      if (sessionId) {
        return {
          sessionId,
          format: "json",
          deviceId: typeof parsedObj.device_id === "string" ? parsedObj.device_id : null,
          accountUuid: typeof parsedObj.account_uuid === "string" ? parsedObj.account_uuid : null,
        };
      }
    }
  } catch {
    // Ignore JSON parse failure and fall back to legacy format.
  }

  const legacyMatch = trimmed.match(LEGACY_PATTERN);
  if (!legacyMatch) {
    return emptyParseResult();
  }

  const [, deviceId, rawSessionId] = legacyMatch;
  const sessionId = rawSessionId?.trim();
  if (!sessionId) {
    return emptyParseResult();
  }

  return {
    sessionId,
    format: "legacy",
    deviceId: deviceId || null,
    accountUuid: null,
  };
}

export function buildClaudeMetadataUserId(args: BuildClaudeMetadataUserIdArgs): string {
  const deviceId = buildClaudeMetadataDeviceId(args.keyId);
  const format = resolveClaudeMetadataUserIdFormat(args.userAgent);

  if (format === "legacy") {
    return `user_${deviceId}_account__session_${args.sessionId}`;
  }

  return JSON.stringify({
    device_id: deviceId,
    account_uuid: "",
    session_id: args.sessionId,
  });
}

export function injectClaudeMetadataUserIdWithContext(
  message: Record<string, unknown>,
  args: InjectClaudeMetadataUserIdArgs
): Record<string, unknown> {
  const existingMetadata =
    typeof message.metadata === "object" && message.metadata !== null
      ? (message.metadata as Record<string, unknown>)
      : undefined;

  if (hasUsableClaudeMetadataUserId(existingMetadata?.user_id)) {
    return message;
  }

  if (args.keyId == null || !args.sessionId) {
    return message;
  }

  return {
    ...message,
    metadata: {
      ...existingMetadata,
      user_id: buildClaudeMetadataUserId({
        keyId: args.keyId,
        sessionId: args.sessionId,
        userAgent: args.userAgent,
      }),
    },
  };
}
