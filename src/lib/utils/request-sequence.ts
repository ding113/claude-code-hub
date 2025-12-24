/**
 * Normalize request sequence number
 *
 * Ensures the sequence is a positive safe integer for multi-request session scenarios
 *
 * @param requestSequence - Raw sequence number
 * @returns Normalized sequence number, or null for invalid input
 */
export function normalizeRequestSequence(requestSequence?: number): number | null {
  if (typeof requestSequence !== "number") return null;
  if (!Number.isSafeInteger(requestSequence)) return null;
  if (requestSequence <= 0) return null;
  return requestSequence;
}
