import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * Uses crypto.timingSafeEqual internally. When lengths differ, a dummy
 * comparison is still performed so the total CPU time does not leak
 * length information.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");

  if (bufA.length !== bufB.length) {
    // Pad both to the same length so the dummy comparison time does not
    // leak which side is shorter (attacker may control either one).
    const padLen = Math.max(bufA.length, bufB.length);
    const padA = Buffer.alloc(padLen);
    const padB = Buffer.alloc(padLen);
    bufA.copy(padA);
    bufB.copy(padB);
    timingSafeEqual(padA, padB);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}
