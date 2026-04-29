import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnvConfig } from "@/lib/config/env.schema";

const CSRF_WINDOW_MS = 30 * 60 * 1000;

export function getCsrfBucket(now = Date.now()): number {
  return Math.floor(now / CSRF_WINDOW_MS);
}

export function getCsrfSecret(): string | null {
  return getEnvConfig().ADMIN_TOKEN ?? null;
}

export function createCsrfToken(input: {
  authToken: string;
  userId: number;
  now?: number;
  secret?: string | null;
}): string | null {
  const secret = input.secret ?? getCsrfSecret();
  if (!secret) return null;
  const bucket = getCsrfBucket(input.now);
  const payload = `${input.authToken}:${input.userId}:${bucket}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
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

  const secret = input.secret ?? getCsrfSecret();
  if (!secret) return false;
  const payload = `${input.authToken}:${input.userId}:${bucket}`;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  return safeEqual(signature, expected);
}

export function isMutationMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
