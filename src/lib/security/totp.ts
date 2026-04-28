import { createHmac, randomBytes } from "node:crypto";
import { constantTimeEqual } from "@/lib/security/constant-time-compare";

const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;
const DEFAULT_WINDOW = 1;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export interface GenerateTotpOptions {
  secret: string;
  timestampMs?: number;
  stepSeconds?: number;
  digits?: number;
}

export interface VerifyTotpOptions extends GenerateTotpOptions {
  code: string;
  window?: number;
}

export interface BuildTotpAuthUriOptions {
  secret: string;
  accountName: string;
  issuer?: string;
}

function decodeBase32(secret: string): Buffer {
  const normalized = secret.replace(/[\s=-]/g, "").toUpperCase();
  if (!normalized) {
    throw new Error("TOTP secret is empty");
  }

  let bits = "";
  const bytes: number[] = [];

  for (const char of normalized) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error("TOTP secret is not valid base32");
    }

    bits += value.toString(2).padStart(5, "0");
    while (bits.length >= 8) {
      bytes.push(Number.parseInt(bits.slice(0, 8), 2));
      bits = bits.slice(8);
    }
  }

  return Buffer.from(bytes);
}

function counterToBuffer(counter: number): Buffer {
  const buffer = Buffer.alloc(8);
  let value = counter;

  for (let i = 7; i >= 0; i--) {
    buffer[i] = value & 0xff;
    value = Math.floor(value / 256);
  }

  return buffer;
}

function normalizeDigits(value: number | undefined): number {
  if (!Number.isInteger(value) || value == null) return DEFAULT_DIGITS;
  return Math.min(10, Math.max(6, value));
}

function encodeBase32(bytes: Buffer): string {
  let bits = "";
  let output = "";

  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, "0");
    while (bits.length >= 5) {
      output += BASE32_ALPHABET[Number.parseInt(bits.slice(0, 5), 2)];
      bits = bits.slice(5);
    }
  }

  if (bits.length > 0) {
    output += BASE32_ALPHABET[Number.parseInt(bits.padEnd(5, "0"), 2)];
  }

  return output;
}

export function generateBase32Secret(byteLength = 20): string {
  const length = Math.min(64, Math.max(10, Math.floor(byteLength)));
  return encodeBase32(randomBytes(length));
}

export function buildTotpAuthUri(options: BuildTotpAuthUriOptions): string {
  const issuer = options.issuer?.trim() || "Claude Code Hub";
  const accountName = options.accountName.trim() || "Web UI";
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret: options.secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

export function generateTotp(options: GenerateTotpOptions): string {
  const stepSeconds = options.stepSeconds ?? DEFAULT_STEP_SECONDS;
  const digits = normalizeDigits(options.digits);
  const timestampMs = options.timestampMs ?? Date.now();
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const hmac = createHmac("sha1", decodeBase32(options.secret))
    .update(counterToBuffer(counter))
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function verifyTotp(options: VerifyTotpOptions): boolean {
  const code = options.code.trim();
  if (!/^\d{6}$/.test(code)) {
    return false;
  }

  const digits = DEFAULT_DIGITS;
  const timestampMs = options.timestampMs ?? Date.now();
  const stepSeconds = options.stepSeconds ?? DEFAULT_STEP_SECONDS;
  const window = Math.max(0, Math.floor(options.window ?? DEFAULT_WINDOW));

  try {
    for (let offset = -window; offset <= window; offset++) {
      const candidate = generateTotp({
        secret: options.secret,
        timestampMs: timestampMs + offset * stepSeconds * 1000,
        stepSeconds,
        digits,
      });

      if (constantTimeEqual(candidate, code)) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}
