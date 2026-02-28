const encoder = new TextEncoder();

/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * Uses bitwise XOR accumulation instead of node:crypto.timingSafeEqual
 * to remain compatible with Edge Runtime. When lengths differ, a dummy
 * comparison is still performed so the total CPU time does not leak
 * length information.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  const lenA = bufA.byteLength;
  const lenB = bufB.byteLength;

  if (lenA !== lenB) {
    // Pad both to the same length so the dummy comparison time does not
    // leak which side is shorter (attacker may control either one).
    const padLen = Math.max(lenA, lenB);
    const padA = new Uint8Array(padLen);
    const padB = new Uint8Array(padLen);
    padA.set(bufA);
    padB.set(bufB);
    let dummy = 0;
    for (let i = 0; i < padLen; i++) {
      dummy |= padA[i] ^ padB[i];
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < lenA; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}
