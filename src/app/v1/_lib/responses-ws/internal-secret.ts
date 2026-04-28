/**
 * Per-process internal secret for the WS -> HTTP loopback tunnel.
 *
 * Why this exists:
 * - server.js accepts client WebSocket upgrades on /v1/responses and tunnels
 *   each frame as an internal HTTP POST against the same listener. To let the
 *   forwarder know the request originated from a real WS client (so it
 *   should attempt an upstream WebSocket dial), we attach internal marker
 *   headers (x-cch-client-transport: websocket, x-cch-responses-ws-forward:
 *   1).
 * - Those headers travel over plain HTTP and would also be settable by an
 *   external attacker simply curl'ing /v1/responses with the right header
 *   names. Without an authentication step, that lets any HTTP client trick
 *   the forwarder into attempting an upstream WS dial.
 *
 * How this fixes it:
 * - At startup the custom server populates `CCH_RESPONSES_WS_INTERNAL_SECRET`
 *   in `process.env` with a single, random per-process secret (or a value
 *   provided by the operator). The custom server adds that secret as the
 *   `x-cch-internal-secret` header on every internal tunnel request.
 * - The eligibility check in the forwarder cross-checks the secret against
 *   the live process value. Internal requests pass; external requests fail
 *   even if they spoof the public marker headers.
 * - server.js ALSO strips any inbound `x-cch-*` headers from the client WS
 *   handshake before tunneling, so this secret is never echoed back to a
 *   third party. That is defense-in-depth on top of the secret check.
 *
 * The secret never leaves this Node process and is never logged.
 */

import { randomUUID } from "node:crypto";

export const INTERNAL_SECRET_HEADER = "x-cch-internal-secret";
export const WS_FORWARD_FLAG_HEADER = "x-cch-responses-ws-forward";
const ENV_VAR = "CCH_RESPONSES_WS_INTERNAL_SECRET";

/**
 * Reserved internal markers. Headers with these names are stripped from any
 * inbound client request at the WS edge, so an attacker cannot inject them
 * even alongside other valid markers.
 */
export const RESERVED_INTERNAL_HEADERS = [
  "x-cch-client-transport",
  WS_FORWARD_FLAG_HEADER,
  INTERNAL_SECRET_HEADER,
];

/**
 * Read the live per-process secret. Returns null when not initialized — this
 * is the safe default and means `verifyInternalRequest` will reject any
 * caller, including the local tunnel, until the secret is available.
 */
export function getInternalSecret(): string | null {
  const value = process.env[ENV_VAR];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Initialize the per-process secret. Called once at server startup. Returns
 * the resolved secret. If the operator preset `CCH_RESPONSES_WS_INTERNAL_SECRET`
 * we honor that; otherwise a UUIDv4 is generated.
 *
 * Idempotent — repeated calls return the existing value so test harnesses
 * can safely re-run setup.
 */
export function ensureInternalSecret(): string {
  const existing = getInternalSecret();
  if (existing) return existing;
  const generated = randomUUID();
  process.env[ENV_VAR] = generated;
  return generated;
}

/**
 * Constant-time secret compare to avoid trivial timing oracles. The secret
 * is short (UUID), so this is just hygiene; the real protection is that the
 * value is never sent off-process.
 */
function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function readHeader(headers: Headers | Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  if (headers instanceof Headers) {
    return headers.get(lower) ?? undefined;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/**
 * Returns true iff the request carries the live per-process internal secret
 * AND the WS-forward flag. Any external client trying to mark itself as a
 * WS-tunnel request without knowing the secret is rejected here.
 */
export function verifyInternalRequest(headers: Headers | Record<string, string>): boolean {
  const secret = getInternalSecret();
  if (!secret) return false;
  const provided = readHeader(headers, INTERNAL_SECRET_HEADER);
  if (typeof provided !== "string" || provided.length === 0) return false;
  if (!safeEquals(secret, provided)) return false;
  // Belt-and-braces: even with a valid secret, the call must include the
  // explicit forward flag. Misses here would only happen if server.js
  // forgets to set it — surfacing that as a hard fail prevents accidental
  // bypass via shared secret leakage to other internal callers.
  const forwardFlag = readHeader(headers, WS_FORWARD_FLAG_HEADER);
  return forwardFlag === "1";
}
