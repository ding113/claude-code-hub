import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnvConfig } from "@/lib/config/env.schema";

const CSRF_WINDOW_MS = 30 * 60 * 1000;

export function getCsrfBucket(now = Date.now()): number {
  return Math.floor(now / CSRF_WINDOW_MS);
}

export function getCsrfSecret(): string | null {
  const env = getEnvConfig();
  return env.CSRF_SECRET ?? env.ADMIN_TOKEN ?? null;
}

export function createCsrfToken(input: {
  authToken: string;
  userId: number;
  now?: number;
  secret?: string | null;
}): string | null {
  const secret = resolveCsrfSecret(input.authToken, input.secret);
  if (!secret) return null;
  const bucket = getCsrfBucket(input.now);
  const payload = `${input.authToken}:${input.userId}:${bucket}`;
  const signature = signCsrfPayload(payload, secret).toString("base64url");
  return `${bucket}.${signature}`;
}

export function verifyCsrfToken(input: {
  token: string | null | undefined;
  authToken: string;
  userId: number;
  now?: number;
  secret?: string | null;
}): boolean {
  if (!input.token) return false;
  const [bucketText, signature] = input.token.split(".");
  const bucket = Number(bucketText);
  if (!Number.isInteger(bucket) || !signature) return false;

  const currentBucket = getCsrfBucket(input.now);
  if (bucket !== currentBucket && bucket !== currentBucket - 1) return false;

  const secret = resolveCsrfSecret(input.authToken, input.secret);
  if (!secret) return false;
  const payload = `${input.authToken}:${input.userId}:${bucket}`;
  const expected = signCsrfPayload(payload, secret);
  return safeEqual(signature, expected);
}

export function isMutationMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

function signCsrfPayload(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

function resolveCsrfSecret(authToken: string, explicitSecret?: string | null): string | null {
  return explicitSecret ?? getCsrfSecret() ?? authToken;
}

function safeEqual(signature: string, expected: Buffer): boolean {
  const actual = Buffer.from(signature, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
