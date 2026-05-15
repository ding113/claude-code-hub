import { constantTimeEqual } from "@/lib/security/constant-time-compare";

export const SIGNED_ADMIN_SESSION_TOKEN_PREFIX = "cch_admin_session_v1.";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_TOKEN_LENGTH = 4096;

interface SignedAdminSessionPayload {
  v: 1;
  typ: "admin-session";
  iat: number;
  exp: number;
  nonce: string;
}

export interface CreateSignedAdminSessionTokenOptions {
  adminToken: string;
  ttlSeconds: number;
  now?: number;
}

export interface VerifySignedAdminSessionTokenOptions {
  adminToken: string;
  maxTtlSeconds: number;
  now?: number;
}

let cachedSigningKey: { adminToken: string; keyPromise: Promise<CryptoKey> } | null = null;

function encodeBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? textEncoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64UrlToString(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  const paddedLength = Math.ceil(value.length / 4) * 4;
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(paddedLength, "=");

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return textDecoder.decode(bytes);
  } catch {
    return null;
  }
}

function getSigningKey(adminToken: string): Promise<CryptoKey> {
  if (cachedSigningKey?.adminToken === adminToken) {
    return cachedSigningKey.keyPromise;
  }

  const signingSecret = `cch-admin-session-token-v1:${adminToken}`;
  const keyPromise = globalThis.crypto.subtle.importKey(
    "raw",
    textEncoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  cachedSigningKey = { adminToken, keyPromise };
  return keyPromise;
}

async function signAdminSessionValue(value: string, adminToken: string): Promise<string> {
  const key = await getSigningKey(adminToken);
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return encodeBase64Url(new Uint8Array(signature));
}

function parseSignedAdminSessionPayload(raw: string): SignedAdminSessionPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;
    if (obj.v !== 1) return null;
    if (obj.typ !== "admin-session") return null;
    if (typeof obj.iat !== "number" || !Number.isFinite(obj.iat)) return null;
    if (typeof obj.exp !== "number" || !Number.isFinite(obj.exp)) return null;
    if (typeof obj.nonce !== "string" || obj.nonce.length === 0) return null;

    return {
      v: obj.v,
      typ: obj.typ,
      iat: obj.iat,
      exp: obj.exp,
      nonce: obj.nonce,
    };
  } catch {
    return null;
  }
}

function normalizeTtlSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function isSignedAdminSessionTokenFormat(token: string): boolean {
  return token.startsWith(SIGNED_ADMIN_SESSION_TOKEN_PREFIX);
}

export async function createSignedAdminSessionToken({
  adminToken,
  ttlSeconds,
  now = Date.now(),
}: CreateSignedAdminSessionTokenOptions): Promise<string> {
  const normalizedTtlSeconds = normalizeTtlSeconds(ttlSeconds);
  if (!adminToken || normalizedTtlSeconds <= 0) {
    throw new Error("Invalid admin session token input");
  }

  const payload: SignedAdminSessionPayload = {
    v: 1,
    typ: "admin-session",
    iat: now,
    exp: now + normalizedTtlSeconds * 1000,
    nonce: globalThis.crypto.randomUUID(),
  };

  const payloadPart = encodeBase64Url(JSON.stringify(payload));
  const signedValue = `${SIGNED_ADMIN_SESSION_TOKEN_PREFIX}${payloadPart}`;
  const signature = await signAdminSessionValue(signedValue, adminToken);
  return `${signedValue}.${signature}`;
}

export async function verifySignedAdminSessionToken(
  token: string,
  { adminToken, maxTtlSeconds, now = Date.now() }: VerifySignedAdminSessionTokenOptions
): Promise<boolean> {
  if (!adminToken || token.length > MAX_TOKEN_LENGTH || !isSignedAdminSessionTokenFormat(token)) {
    return false;
  }

  const withoutPrefix = token.slice(SIGNED_ADMIN_SESSION_TOKEN_PREFIX.length);
  const separatorIndex = withoutPrefix.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex !== withoutPrefix.lastIndexOf(".")) {
    return false;
  }

  const payloadPart = withoutPrefix.slice(0, separatorIndex);
  const signature = withoutPrefix.slice(separatorIndex + 1);
  if (!payloadPart || !signature) {
    return false;
  }

  const signedValue = `${SIGNED_ADMIN_SESSION_TOKEN_PREFIX}${payloadPart}`;
  const expectedSignature = await signAdminSessionValue(signedValue, adminToken);
  if (!constantTimeEqual(signature, expectedSignature)) {
    return false;
  }

  const payloadRaw = decodeBase64UrlToString(payloadPart);
  if (!payloadRaw) {
    return false;
  }

  const payload = parseSignedAdminSessionPayload(payloadRaw);
  if (!payload) {
    return false;
  }

  const maxTtlMs = normalizeTtlSeconds(maxTtlSeconds) * 1000;
  if (maxTtlMs <= 0) {
    return false;
  }

  if (payload.exp <= payload.iat) {
    return false;
  }

  // 当前 TTL 是签发时间起算的有效期上限；降低配置会收紧旧 cookie 的剩余寿命，但不会立即踢掉仍在新窗口内的会话。
  const effectiveExpiresAt = Math.min(payload.exp, payload.iat + maxTtlMs);
  if (payload.iat > now + CLOCK_SKEW_MS || effectiveExpiresAt <= now) {
    return false;
  }

  return true;
}
