import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getEnvConfig } from "@/lib/config/env.schema";

const FORMAT_VERSION = "v1";
const CURRENT_KEY_VERSION = 1;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export type TotpSecretKeySource = "totp-secret-encryption-key" | "admin-token" | "missing";

export class TotpSecretDecryptionError extends Error {
  constructor(message = "Failed to decrypt TOTP secret") {
    super(message);
    this.name = "TotpSecretDecryptionError";
  }
}

export function getTotpSecretKeySource(): TotpSecretKeySource {
  const env = getEnvConfig();
  if (env.TOTP_SECRET_ENCRYPTION_KEY) {
    return "totp-secret-encryption-key";
  }
  if (env.ADMIN_TOKEN) {
    return "admin-token";
  }

  return "missing";
}

function getKeyMaterial(): string {
  const env = getEnvConfig();
  if (env.TOTP_SECRET_ENCRYPTION_KEY) {
    return env.TOTP_SECRET_ENCRYPTION_KEY;
  }
  if (env.ADMIN_TOKEN) {
    return env.ADMIN_TOKEN;
  }

  throw new Error("TOTP_SECRET_ENCRYPTION_KEY is required to store authenticator secrets");
}

export function isTotpSecretEncryptionConfigured(): boolean {
  return getTotpSecretKeySource() !== "missing";
}

function getAesKey(): Buffer {
  return createHash("sha256").update(getKeyMaterial()).digest();
}

export function getTotpSecretKeyVersion(): number {
  return CURRENT_KEY_VERSION;
}

export function encryptTotpSecret(secret: string): { ciphertext: string; keyVersion: number } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getAesKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: [
      FORMAT_VERSION,
      iv.toString("base64url"),
      tag.toString("base64url"),
      encrypted.toString("base64url"),
    ].join(":"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decryptTotpSecret(ciphertext: string | null): string | null {
  if (!ciphertext) {
    return null;
  }

  const [version, ivValue, tagValue, encryptedValue] = ciphertext.split(":");
  if (version !== FORMAT_VERSION || !ivValue || !tagValue || !encryptedValue) {
    return ciphertext;
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getAesKey(),
      Buffer.from(ivValue, "base64url"),
      {
        authTagLength: AUTH_TAG_LENGTH,
      }
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new TotpSecretDecryptionError(
      error instanceof Error ? error.message : "Failed to decrypt TOTP secret"
    );
  }
}
