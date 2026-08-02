/**
 * Encrypt site credentials at rest (password / captcha key / session tokens).
 * Uses AES-256-GCM with a key derived from SITE_CREDENTIALS_KEY or ADMIN_TOKEN.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1:";

function resolveKeyMaterial(): Buffer {
  const raw =
    process.env.SITE_CREDENTIALS_KEY?.trim() ||
    process.env.ADMIN_TOKEN?.trim() ||
    process.env.ENCRYPTION_KEY?.trim() ||
    "";
  if (!raw) {
    // Deterministic fallback so local/dev still works; production should set a real key.
    return createHash("sha256").update("cch-provider-site-credentials-dev-key").digest();
  }
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null) return null;
  const text = String(plain);
  if (!text) return null;
  const key = resolveKeyMaterial();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(cipherText: string | null | undefined): string | null {
  if (!cipherText) return null;
  const raw = String(cipherText);
  if (!raw.startsWith(PREFIX)) {
    // Legacy / plaintext fallback for migration edge cases.
    return raw;
  }
  const body = raw.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = body.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("invalid secret ciphertext");
  }
  const key = resolveKeyMaterial();
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function hasSecret(cipherText: string | null | undefined): boolean {
  return Boolean(cipherText && String(cipherText).length > 0);
}
