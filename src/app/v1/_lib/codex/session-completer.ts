import "server-only";

import crypto from "node:crypto";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";
import { normalizeCodexSessionId } from "./session-extractor";

export type CodexSessionCompletionAction =
  | "none"
  | "completed_missing_fields"
  | "generated_uuid_v7"
  | "reused_fingerprint_cache";

export type CodexSessionCompletionSource =
  | "header_session_id"
  | "header_x_session_id"
  | "body_prompt_cache_key"
  | "fingerprint_cache"
  | "generated_uuid_v7";

export type CodexSessionCompletionResult = {
  applied: boolean;
  action: CodexSessionCompletionAction;
  sessionId: string;
  source: CodexSessionCompletionSource;
};

type CompleteArgs = {
  keyId: number;
  headers: Headers;
  requestBody: Record<string, unknown>;
  userAgent: string | null;
};

function getSessionTtlSeconds(): number {
  const raw = process.env.SESSION_TTL;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 300;
  }
  return parsed;
}

function extractClientIp(headers: Headers): string | null {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean)[0];
    if (first) return first;
  }

  const realIp = headers.get("x-real-ip");
  return realIp ? realIp.trim() : null;
}

function extractInitialMessageTextHash(requestBody: Record<string, unknown>): string | null {
  const input = requestBody.input;
  if (!Array.isArray(input) || input.length === 0) {
    return null;
  }

  const texts: string[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;

    // Only consider "message" items for conversation fingerprinting.
    const itemType = typeof obj.type === "string" ? obj.type : null;
    if (itemType && itemType !== "message") continue;

    const content = obj.content;

    if (typeof content === "string") {
      if (content.trim()) texts.push(content);
    } else if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const partObj = part as Record<string, unknown>;
        const text = typeof partObj.text === "string" ? partObj.text : null;
        if (!text) continue;
        parts.push(text);
      }
      const joined = parts.join("");
      if (joined.trim()) texts.push(joined);
    }

    if (texts.length >= 3) {
      break;
    }
  }

  if (texts.length === 0) return null;

  const combined = texts.join("|");
  const hash = crypto.createHash("sha256").update(combined, "utf8").digest("hex");
  return hash.substring(0, 16);
}

export function generateUuidV7(): string {
  const timestampMs = Date.now();
  const bytes = crypto.randomBytes(16);

  // 48-bit big-endian Unix timestamp in milliseconds
  // Note: avoid BigInt to support TS targets < ES2020.
  let ts = timestampMs;
  bytes[5] = ts % 256;
  ts = Math.floor(ts / 256);
  bytes[4] = ts % 256;
  ts = Math.floor(ts / 256);
  bytes[3] = ts % 256;
  ts = Math.floor(ts / 256);
  bytes[2] = ts % 256;
  ts = Math.floor(ts / 256);
  bytes[1] = ts % 256;
  ts = Math.floor(ts / 256);
  bytes[0] = ts % 256;

  // Version (7): high nibble of byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x70;

  // Variant (RFC 4122): 10xx xxxx in byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

function calculateFingerprintHash(args: CompleteArgs): string | null {
  const ip = extractClientIp(args.headers) ?? "unknown";
  const ua = args.userAgent ?? args.headers.get("user-agent") ?? "unknown";
  const messageHash = extractInitialMessageTextHash(args.requestBody) ?? "unknown";

  const fingerprint = `v1|key:${args.keyId}|ip:${ip}|ua:${ua}|m:${messageHash}`;
  return crypto.createHash("sha256").update(fingerprint, "utf8").digest("hex");
}

type FingerprintSessionIdResult = {
  sessionId: string;
  source: "fingerprint_cache" | "generated_uuid_v7";
  action: "reused_fingerprint_cache" | "generated_uuid_v7";
};

async function getOrCreateSessionIdFromFingerprint(
  args: CompleteArgs
): Promise<FingerprintSessionIdResult> {
  const redis = getRedisClient();
  const ttlSeconds = getSessionTtlSeconds();
  const fingerprintHash = calculateFingerprintHash(args);

  if (!redis || redis.status !== "ready" || !fingerprintHash) {
    return {
      sessionId: generateUuidV7(),
      source: "generated_uuid_v7",
      action: "generated_uuid_v7",
    };
  }

  const redisKey = `codex:fingerprint:${fingerprintHash}:session_id`;

  try {
    const existing = normalizeCodexSessionId(await redis.get(redisKey));
    if (existing) {
      return {
        sessionId: existing,
        source: "fingerprint_cache",
        action: "reused_fingerprint_cache",
      };
    }

    const candidate = generateUuidV7();

    const setResult = await redis.set(redisKey, candidate, "EX", ttlSeconds, "NX");
    if (setResult === "OK") {
      return { sessionId: candidate, source: "generated_uuid_v7", action: "generated_uuid_v7" };
    }

    const existingAfter = normalizeCodexSessionId(await redis.get(redisKey));
    if (existingAfter) {
      return {
        sessionId: existingAfter,
        source: "fingerprint_cache",
        action: "reused_fingerprint_cache",
      };
    }

    await redis.set(redisKey, candidate, "EX", ttlSeconds);
    return { sessionId: candidate, source: "generated_uuid_v7", action: "generated_uuid_v7" };
  } catch (error) {
    logger.warn("[CodexSessionCompleter] Redis unavailable, falling back to UUID v7", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      sessionId: generateUuidV7(),
      source: "generated_uuid_v7",
      action: "generated_uuid_v7",
    };
  }
}

/**
 * Ensure Codex session identifiers exist in both:
 * - Header: `session_id` (+ `x-session-id` for compatibility)
 * - Body: `prompt_cache_key`
 *
 * Completion rules:
 * - If either side provides a valid identifier, copy to the missing side
 * - If both are missing/invalid, generate a UUID v7 and keep stable via fingerprint cache
 */
export async function completeCodexSessionIdentifiers(
  args: CompleteArgs
): Promise<CodexSessionCompletionResult> {
  const headerSessionId = normalizeCodexSessionId(args.headers.get("session_id"));
  const headerXSessionId = normalizeCodexSessionId(args.headers.get("x-session-id"));
  const bodyPromptCacheKey = normalizeCodexSessionId(args.requestBody.prompt_cache_key);

  const missingHeader = !headerSessionId && !headerXSessionId;
  const missingBody = !bodyPromptCacheKey;

  const existing: { sessionId: string; source: CodexSessionCompletionSource } | null =
    headerSessionId
      ? { sessionId: headerSessionId, source: "header_session_id" }
      : headerXSessionId
        ? { sessionId: headerXSessionId, source: "header_x_session_id" }
        : bodyPromptCacheKey
          ? { sessionId: bodyPromptCacheKey, source: "body_prompt_cache_key" }
          : null;

  // Both required fields present: keep as-is (idempotent)
  // Note: x-session-id is treated as a compatibility header and does not satisfy the requirement
  // of having `session_id` present.
  if (headerSessionId && bodyPromptCacheKey && existing) {
    return {
      applied: false,
      action: "none",
      sessionId: existing.sessionId,
      source: existing.source,
    };
  }

  let sessionId: string;
  let source: CodexSessionCompletionSource;
  let action: CodexSessionCompletionAction;

  if (existing) {
    sessionId = existing.sessionId;
    source = existing.source;
    action = "none";
  } else {
    const fingerprintResolved = await getOrCreateSessionIdFromFingerprint(args);
    sessionId = fingerprintResolved.sessionId;
    source = fingerprintResolved.source;
    action = fingerprintResolved.action;
  }

  let applied = false;
  let changedHeaderOrBody = false;

  if (missingHeader) {
    args.headers.set("session_id", sessionId);
    args.headers.set("x-session-id", sessionId);
    applied = true;
    changedHeaderOrBody = true;
  } else if (!headerSessionId && headerXSessionId) {
    // Keep both header keys present for downstream compatibility.
    args.headers.set("session_id", headerXSessionId);
    applied = true;
    changedHeaderOrBody = true;
  } else if (headerSessionId && !headerXSessionId) {
    args.headers.set("x-session-id", headerSessionId);
    applied = true;
    changedHeaderOrBody = true;
  }

  if (missingBody) {
    args.requestBody.prompt_cache_key = sessionId;
    applied = true;
    changedHeaderOrBody = true;
  }

  if (existing) {
    action = changedHeaderOrBody ? "completed_missing_fields" : "none";
  }

  return {
    applied,
    action,
    sessionId,
    source,
  };
}
