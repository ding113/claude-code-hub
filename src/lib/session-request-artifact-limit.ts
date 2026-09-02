import { Buffer } from "node:buffer";
import { getEnvConfig } from "@/lib/config/env.schema";

const DEFAULT_SESSION_REQUEST_ARTIFACT_MAX_BYTES = 5 * 1024 * 1024;

export function getSessionRequestArtifactMaxBytes(): number {
  const configuredMaxBytes = getEnvConfig().SESSION_REQUEST_ARTIFACT_MAX_BYTES;
  return Number.isSafeInteger(configuredMaxBytes) && configuredMaxBytes > 0
    ? configuredMaxBytes
    : DEFAULT_SESSION_REQUEST_ARTIFACT_MAX_BYTES;
}

export function getSessionRequestArtifactByteSize(value: unknown, byteSizeHint?: number): number {
  if (Number.isSafeInteger(byteSizeHint) && byteSizeHint !== undefined && byteSizeHint >= 0) {
    return byteSizeHint;
  }

  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return serialized === undefined ? 0 : Buffer.byteLength(serialized, "utf8");
}
