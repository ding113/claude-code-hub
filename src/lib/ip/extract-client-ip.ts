import { isIP } from "node:net";
import {
  DEFAULT_IP_EXTRACTION_CONFIG,
  type IpExtractionConfig,
  type IpHeaderRule,
  type XffPick,
} from "@/types/ip-extraction";

export type HeadersLike = Headers | Record<string, string | string[] | undefined>;

function readHeader(source: HeadersLike, name: string): string | null {
  if (source instanceof Headers) return source.get(name);
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(source)) {
    if (key.toLowerCase() !== lower) continue;
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }
  return null;
}

/**
 * Normalize a raw header value into a bare IP string (no port, no brackets).
 * Returns null when the value is not a parseable IP.
 */
function normalizeIp(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Bracketed IPv6 with optional port: "[::1]" or "[2001:db8::1]:443"
  const bracketMatch = /^\[([^\]]+)](?::\d+)?$/.exec(trimmed);
  if (bracketMatch) {
    const inner = bracketMatch[1];
    return isIP(inner) ? inner : null;
  }

  // IPv4 with port ("1.2.3.4:5678"): strip port
  // (IPv6 unbracketed can contain colons, so only strip when exactly one colon)
  if (trimmed.split(":").length === 2 && isIP(trimmed.split(":")[0]) === 4) {
    return trimmed.split(":")[0];
  }

  return isIP(trimmed) ? trimmed : null;
}

function pickFromChain(entries: string[], pick: XffPick | undefined): string | null {
  if (entries.length === 0) return null;

  const mode = pick ?? "rightmost";

  if (mode === "leftmost") return entries[0];
  if (mode === "rightmost") return entries[entries.length - 1];

  // Explicit index
  if (typeof mode === "object" && mode.kind === "index") {
    const idx = mode.index;
    if (!Number.isInteger(idx) || idx < 0 || idx >= entries.length) return null;
    return entries[idx];
  }

  return null;
}

function applyRule(source: HeadersLike, rule: IpHeaderRule): string | null {
  const raw = readHeader(source, rule.name);
  if (!raw) return null;

  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;

  const picked = pickFromChain(entries, rule.pick);
  if (!picked) return null;

  return normalizeIp(picked);
}

/**
 * Extract a client IP from request headers using a configurable rule chain.
 *
 * The chain is consulted in order; the first rule that yields a valid IP wins.
 * Invalid / out-of-bounds rules are silently skipped — the function never
 * throws and returns null when no rule matches.
 *
 * @param source Request headers (Hono / Fetch `Headers` or a plain object)
 * @param config Extraction config; falls back to the built-in CDN-aware default
 */
export function extractClientIp(
  source: HeadersLike,
  config: IpExtractionConfig = DEFAULT_IP_EXTRACTION_CONFIG
): string | null {
  for (const rule of config.headers) {
    const ip = applyRule(source, rule);
    if (ip) return ip;
  }
  return null;
}
