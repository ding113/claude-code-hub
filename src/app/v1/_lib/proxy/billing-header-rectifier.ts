/**
 * Billing Header Rectifier - Proactive (pre-send) rectifier for Claude Code client
 * billing header injection.
 *
 * Problem: Claude Code client v2.1.36+ injects `x-anthropic-billing-header: ...`
 * as a text block inside the request body's `system` content array. Non-native
 * Anthropic upstreams (e.g. Amazon Bedrock) reject this with 400:
 * "x-anthropic-billing-header is a reserved keyword and may not be used in the system prompt."
 *
 * Solution: Strip these blocks before forwarding to upstream.
 */

export type BillingHeaderRectifierResult = {
  applied: boolean;
  removedCount: number;
  extractedValues: string[];
};

const BILLING_HEADER_PATTERN = /^\s*x-anthropic-billing-header\s*:/i;

/**
 * Remove x-anthropic-billing-header text blocks from the request system prompt.
 * Mutates the message object in place (matches existing rectifier conventions).
 */
export function rectifyBillingHeader(
  message: Record<string, unknown>
): BillingHeaderRectifierResult {
  const system = message.system;

  // Case 1: system is undefined/null/missing
  if (system === undefined || system === null) {
    return { applied: false, removedCount: 0, extractedValues: [] };
  }

  // Case 2: system is a plain string
  if (typeof system === "string") {
    if (BILLING_HEADER_PATTERN.test(system)) {
      const extractedValues = [system.trim()];
      delete message.system;
      return { applied: true, removedCount: 1, extractedValues };
    }
    return { applied: false, removedCount: 0, extractedValues: [] };
  }

  // Case 3: system is an array of content blocks
  if (Array.isArray(system)) {
    const extractedValues: string[] = [];
    const filtered: unknown[] = [];

    for (const block of system) {
      if (
        block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string" &&
        BILLING_HEADER_PATTERN.test((block as Record<string, unknown>).text as string)
      ) {
        extractedValues.push(((block as Record<string, unknown>).text as string).trim());
      } else {
        filtered.push(block);
      }
    }

    if (extractedValues.length > 0) {
      // Mutate in place: replace system array contents
      system.length = 0;
      for (const item of filtered) {
        system.push(item);
      }
      return { applied: true, removedCount: extractedValues.length, extractedValues };
    }

    return { applied: false, removedCount: 0, extractedValues: [] };
  }

  // Unknown type: no-op
  return { applied: false, removedCount: 0, extractedValues: [] };
}
