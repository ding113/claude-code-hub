import { randomBytes, randomUUID } from "node:crypto";

export type ClaudeCodeMetadataUserIdFormat = "legacy" | "json";

export interface ClaudeCodeMetadataUserIdParts {
  deviceId: string | null;
  accountUuid: string | null;
  sessionId: string | null;
}

export interface ParsedClaudeCodeMetadataUserId extends ClaudeCodeMetadataUserIdParts {
  format: "legacy" | "json";
  raw: string;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseClaudeCodeMetadataUserId(
  value: unknown
): ParsedClaudeCodeMetadataUserId | null {
  const raw = normalizeString(value);
  if (!raw) {
    return null;
  }

  if (raw.startsWith("json")) {
    try {
      const parsed = JSON.parse(raw.slice(4)) as Record<string, unknown>;
      return {
        format: "json",
        raw,
        deviceId: normalizeString(parsed.device_id),
        accountUuid: normalizeString(parsed.account_uuid),
        sessionId: normalizeString(parsed.session_id),
      };
    } catch {
      return null;
    }
  }

  const legacyMatch = raw.match(/^user_(.+?)_account_(.*?)_session_(.+)$/);
  if (!legacyMatch) {
    return null;
  }

  return {
    format: "legacy",
    raw,
    deviceId: normalizeString(legacyMatch[1]),
    accountUuid: normalizeString(legacyMatch[2]),
    sessionId: normalizeString(legacyMatch[3]),
  };
}

export function buildClaudeCodeMetadataUserId(
  parts: Partial<ClaudeCodeMetadataUserIdParts> = {},
  format: ClaudeCodeMetadataUserIdFormat = "json"
): string {
  const deviceId = parts.deviceId?.trim() || randomBytes(32).toString("hex");
  const accountUuid = parts.accountUuid?.trim() || randomUUID();
  const sessionId = parts.sessionId?.trim() || randomUUID();

  if (format === "legacy") {
    return `user_${deviceId}_account_${accountUuid}_session_${sessionId}`;
  }

  return `json${JSON.stringify({
    device_id: deviceId,
    account_uuid: accountUuid,
    session_id: sessionId,
  })}`;
}

export function extractSessionIdFromClaudeCodeMetadataUserId(value: unknown): string | null {
  return parseClaudeCodeMetadataUserId(value)?.sessionId ?? null;
}
