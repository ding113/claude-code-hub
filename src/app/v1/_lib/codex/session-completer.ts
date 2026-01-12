import "server-only";

import crypto from "node:crypto";
import { normalizeCodexSessionId } from "@/app/v1/_lib/codex/session-extractor";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";

export type CodexSessionIdCompletionAction =
  | "noop"
  | "copied_header_to_body"
  | "copied_body_to_header"
  | "copied_metadata_to_header_and_body"
  | "aligned_mismatch"
  | "generated";

export interface CodexSessionIdCompletionResult {
  applied: boolean;
  action: CodexSessionIdCompletionAction;
  sessionId: string | null;
  fingerprint: string | null;
  redis: { used: boolean; hit: boolean };
}

const SESSION_TTL_SECONDS = parseInt(process.env.SESSION_TTL || "300", 10);

function getClientIp(headers: Headers): string | null {
  // 取链路上的首个 IP
  const forwardedFor = headers.get("x-forwarded-for");
  const realIp = headers.get("x-real-ip");
  const ip =
    forwardedFor?.split(",").map((part) => part.trim())[0] || (realIp ? realIp.trim() : null);
  return ip || null;
}

function ensureObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractTextParts(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const obj = ensureObject(item);
      const text = obj ? obj.text : null;
      if (typeof text === "string" && text.trim()) {
        parts.push(text.trim());
      }
    }
    return parts;
  }

  return [];
}

function calculateInitialMessageHash(requestBody: Record<string, unknown>): string | null {
  const input = requestBody.input;
  if (!Array.isArray(input) || input.length === 0) return null;

  let systemText: string | null = null;
  let userText: string | null = null;

  for (const item of input) {
    const obj = ensureObject(item);
    if (!obj) continue;
    const role = typeof obj.role === "string" ? obj.role.toLowerCase() : null;
    if (role !== "system") continue;

    const texts = extractTextParts(obj.content);
    const joined = texts.join("\n").trim();
    if (joined) {
      systemText = joined;
      break;
    }
  }

  for (const item of input) {
    const obj = ensureObject(item);
    if (!obj) continue;
    const role = typeof obj.role === "string" ? obj.role.toLowerCase() : null;
    if (role !== "user") continue;

    const texts = extractTextParts(obj.content);
    const joined = texts.join("\n").trim();
    if (joined) {
      userText = joined;
      break;
    }
  }

  if (!systemText && !userText) {
    const first = ensureObject(input[0]);
    if (!first) return null;
    const texts = extractTextParts(first.content);
    const joined = texts.join("\n").trim();
    if (!joined) return null;
    return crypto.createHash("sha256").update(joined, "utf8").digest("hex").slice(0, 16);
  }

  const combined = [systemText, userText].filter(Boolean).join("\n");
  return crypto.createHash("sha256").update(combined, "utf8").digest("hex").slice(0, 16);
}

function calculateFingerprint(
  keyId: number,
  headers: Headers,
  requestBody: Record<string, unknown>
) {
  const ip = getClientIp(headers);
  const userAgent = headers.get("user-agent");
  const initialHash = calculateInitialMessageHash(requestBody);

  const parts = [`key:${keyId}`, ip ? `ip:${ip}` : null, userAgent ? `ua:${userAgent}` : null];
  if (initialHash) {
    parts.push(`init:${initialHash}`);
  }

  const filtered = parts.filter(Boolean);
  if (filtered.length === 0) return null;

  return crypto.createHash("sha256").update(filtered.join("|"), "utf8").digest("hex").slice(0, 32);
}

function formatUuidBytes(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generate a UUID v7 string.
 *
 * Layout (RFC 9562):
 * - 48-bit unix epoch timestamp in milliseconds
 * - Version 7 (4 bits)
 * - Remaining bits are random with RFC variant
 */
export function generateUuidV7(): string {
  // Date.now() is an integer and safely representable (< 2^53).
  const timestampMs = Date.now();
  const bytes = new Uint8Array(16);

  // 48-bit timestamp, big-endian
  let t = timestampMs;
  bytes[5] = t % 256;
  t = Math.floor(t / 256);
  bytes[4] = t % 256;
  t = Math.floor(t / 256);
  bytes[3] = t % 256;
  t = Math.floor(t / 256);
  bytes[2] = t % 256;
  t = Math.floor(t / 256);
  bytes[1] = t % 256;
  t = Math.floor(t / 256);
  bytes[0] = t % 256;

  crypto.randomFillSync(bytes.subarray(6));

  // Set version (7)
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Set variant (RFC 4122)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return formatUuidBytes(bytes);
}

function getRedisKey(fingerprint: string): string {
  return `codex:fingerprint:${fingerprint}:session_id`;
}

function readMetadataSessionId(requestBody: Record<string, unknown>): string | null {
  const metadata = ensureObject(requestBody.metadata);
  if (!metadata) return null;
  return normalizeCodexSessionId(metadata.session_id);
}

function ensureMetadataObject(requestBody: Record<string, unknown>): Record<string, unknown> {
  const existing = ensureObject(requestBody.metadata);
  if (existing) return existing;
  const created: Record<string, unknown> = {};
  requestBody.metadata = created;
  return created;
}

function setIfMissingOrDifferent(current: string | null, next: string, set: () => void): boolean {
  if (!current) {
    set();
    return true;
  }
  if (current !== next) {
    set();
    return true;
  }
  return false;
}

export class CodexSessionIdCompleter {
  static async complete(
    keyId: number,
    headers: Headers,
    requestBody: Record<string, unknown>
  ): Promise<CodexSessionIdCompletionResult> {
    const headerSessionId = normalizeCodexSessionId(headers.get("session_id"));
    const headerXSessionId = normalizeCodexSessionId(headers.get("x-session-id"));
    const bodyPromptCacheKey = normalizeCodexSessionId(requestBody.prompt_cache_key);
    const metadataSessionId = readMetadataSessionId(requestBody);

    const fingerprint = calculateFingerprint(keyId, headers, requestBody);

    // Case: both prompt_cache_key and any session header are present
    if (bodyPromptCacheKey && (headerSessionId || headerXSessionId)) {
      const canonicalHeader = headerSessionId ?? headerXSessionId;

      // If they differ, align to header to avoid ambiguity
      if (canonicalHeader && canonicalHeader !== bodyPromptCacheKey) {
        const wroteSessionIdHeader = setIfMissingOrDifferent(headerSessionId, canonicalHeader, () =>
          headers.set("session_id", canonicalHeader)
        );
        const wroteXSessionIdHeader = setIfMissingOrDifferent(
          headerXSessionId,
          canonicalHeader,
          () => headers.set("x-session-id", canonicalHeader)
        );
        const wroteHeader = wroteSessionIdHeader || wroteXSessionIdHeader;

        const wroteBody = setIfMissingOrDifferent(bodyPromptCacheKey, canonicalHeader, () => {
          requestBody.prompt_cache_key = canonicalHeader;
        });

        const wroteMetadata = setIfMissingOrDifferent(metadataSessionId, canonicalHeader, () => {
          const metadata = ensureMetadataObject(requestBody);
          metadata.session_id = canonicalHeader;
        });

        if (fingerprint) {
          await CodexSessionIdCompleter.storeFingerprintMapping(fingerprint, canonicalHeader);
        }

        return {
          applied: wroteHeader || wroteBody || wroteMetadata,
          action: "aligned_mismatch",
          sessionId: canonicalHeader,
          fingerprint,
          redis: { used: false, hit: false },
        };
      }

      // Already consistent, no-op (but keep mapping warm if possible)
      if (canonicalHeader) {
        // Some clients may only send x-session-id without session_id.
        // If prompt_cache_key is present, we treat it as having the session id and fill session_id.
        if (!headerSessionId) {
          headers.set("session_id", canonicalHeader);
          const metadata = ensureMetadataObject(requestBody);
          metadata.session_id = canonicalHeader;

          if (fingerprint) {
            await CodexSessionIdCompleter.storeFingerprintMapping(fingerprint, canonicalHeader);
          }

          return {
            applied: true,
            action: "copied_body_to_header",
            sessionId: canonicalHeader,
            fingerprint,
            redis: { used: false, hit: false },
          };
        }

        if (fingerprint) {
          await CodexSessionIdCompleter.storeFingerprintMapping(fingerprint, canonicalHeader);
        }
      }

      return {
        applied: false,
        action: "noop",
        sessionId: canonicalHeader ?? bodyPromptCacheKey,
        fingerprint,
        redis: { used: false, hit: false },
      };
    }

    // Case: header exists but body missing
    if (headerSessionId || headerXSessionId) {
      const canonical = headerSessionId ?? headerXSessionId;
      if (!canonical) {
        return {
          applied: false,
          action: "noop",
          sessionId: null,
          fingerprint,
          redis: { used: false, hit: false },
        };
      }

      const wroteSessionIdHeader = setIfMissingOrDifferent(headerSessionId, canonical, () =>
        headers.set("session_id", canonical)
      );
      const wroteXSessionIdHeader = setIfMissingOrDifferent(headerXSessionId, canonical, () =>
        headers.set("x-session-id", canonical)
      );
      const wroteHeader = wroteSessionIdHeader || wroteXSessionIdHeader;

      const wroteBody = setIfMissingOrDifferent(bodyPromptCacheKey, canonical, () => {
        requestBody.prompt_cache_key = canonical;
      });

      const wroteMetadata = setIfMissingOrDifferent(metadataSessionId, canonical, () => {
        const metadata = ensureMetadataObject(requestBody);
        metadata.session_id = canonical;
      });

      if (fingerprint) {
        await CodexSessionIdCompleter.storeFingerprintMapping(fingerprint, canonical);
      }

      return {
        applied: wroteHeader || wroteBody || wroteMetadata,
        action: wroteBody ? "copied_header_to_body" : "noop",
        sessionId: canonical,
        fingerprint,
        redis: { used: false, hit: false },
      };
    }

    // Case: body prompt_cache_key exists but header missing
    if (bodyPromptCacheKey) {
      const canonical = bodyPromptCacheKey;

      const wroteSessionIdHeader = setIfMissingOrDifferent(headerSessionId, canonical, () =>
        headers.set("session_id", canonical)
      );
      const wroteXSessionIdHeader = setIfMissingOrDifferent(headerXSessionId, canonical, () =>
        headers.set("x-session-id", canonical)
      );
      const wroteHeader = wroteSessionIdHeader || wroteXSessionIdHeader;

      const wroteMetadata = setIfMissingOrDifferent(metadataSessionId, canonical, () => {
        const metadata = ensureMetadataObject(requestBody);
        metadata.session_id = canonical;
      });

      if (fingerprint) {
        await CodexSessionIdCompleter.storeFingerprintMapping(fingerprint, canonical);
      }

      return {
        applied: wroteHeader || wroteMetadata,
        action: wroteHeader ? "copied_body_to_header" : "noop",
        sessionId: canonical,
        fingerprint,
        redis: { used: false, hit: false },
      };
    }

    // Case: metadata.session_id exists but both header/body missing
    if (metadataSessionId) {
      const canonical = metadataSessionId;

      const wroteSessionIdHeader = setIfMissingOrDifferent(headerSessionId, canonical, () =>
        headers.set("session_id", canonical)
      );
      const wroteXSessionIdHeader = setIfMissingOrDifferent(headerXSessionId, canonical, () =>
        headers.set("x-session-id", canonical)
      );
      const wroteHeader = wroteSessionIdHeader || wroteXSessionIdHeader;

      const wroteBody = setIfMissingOrDifferent(bodyPromptCacheKey, canonical, () => {
        requestBody.prompt_cache_key = canonical;
      });

      if (fingerprint) {
        await CodexSessionIdCompleter.storeFingerprintMapping(fingerprint, canonical);
      }

      return {
        applied: wroteHeader || wroteBody,
        action: "copied_metadata_to_header_and_body",
        sessionId: canonical,
        fingerprint,
        redis: { used: false, hit: false },
      };
    }

    // Case: none provided → generate UUID v7 (with Redis-backed fingerprint reuse when possible)
    const { sessionId, redisUsed, redisHit } =
      await CodexSessionIdCompleter.getOrCreateSessionIdFromFingerprint(fingerprint);

    headers.set("session_id", sessionId);
    headers.set("x-session-id", sessionId);
    requestBody.prompt_cache_key = sessionId;
    const metadata = ensureMetadataObject(requestBody);
    metadata.session_id = sessionId;

    return {
      applied: true,
      action: "generated",
      sessionId,
      fingerprint,
      redis: { used: redisUsed, hit: redisHit },
    };
  }

  private static async getOrCreateSessionIdFromFingerprint(
    fingerprint: string | null
  ): Promise<{ sessionId: string; redisUsed: boolean; redisHit: boolean }> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready" || !fingerprint) {
      return { sessionId: generateUuidV7(), redisUsed: false, redisHit: false };
    }

    const key = getRedisKey(fingerprint);
    try {
      const existing = await redis.get(key);
      const normalized = normalizeCodexSessionId(existing);
      if (normalized) {
        await redis.expire(key, SESSION_TTL_SECONDS);
        return { sessionId: normalized, redisUsed: true, redisHit: true };
      }

      const created = generateUuidV7();
      await redis.setex(key, SESSION_TTL_SECONDS, created);
      return { sessionId: created, redisUsed: true, redisHit: false };
    } catch (error) {
      logger.warn("[CodexSessionIdCompleter] Redis error, falling back to local UUID", {
        error,
      });
      return { sessionId: generateUuidV7(), redisUsed: false, redisHit: false };
    }
  }

  private static async storeFingerprintMapping(
    fingerprint: string,
    sessionId: string
  ): Promise<void> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return;

    try {
      await redis.setex(getRedisKey(fingerprint), SESSION_TTL_SECONDS, sessionId);
    } catch (error) {
      logger.warn("[CodexSessionIdCompleter] Failed to store fingerprint mapping", { error });
    }
  }
}
