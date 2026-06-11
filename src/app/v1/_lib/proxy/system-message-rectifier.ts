/**
 * System Message Rectifier - Proactive (pre-send) rectifier for Claude Code client
 * `role: "system"` message injection.
 *
 * Problem: Claude Code client v2.1.172+ (behavior introduced after v2.1.153) injects
 * the skills list as a standalone `{"role": "system", "content": "..."}` entry in the
 * `messages` array when the configured model name is not a built-in official Claude
 * model ID. The official Anthropic API accepts this, but strict Anthropic-compatible
 * upstreams (Vertex / Bedrock style conversion layers) only allow `user` / `assistant`
 * roles in `messages` and reject the request with a 400 error.
 *
 * Solution: Before forwarding, extract `role: "system"` entries from `messages` and
 * merge their text content into the top-level `system` field (appending as
 * `{type: "text", text}` blocks). This matches how the official API interprets such
 * messages, so permissive upstreams see no behavior change while strict upstreams no
 * longer reject the request.
 */

export type SystemMessageRectifierResult = {
  applied: boolean;
  movedCount: number;
  extractedValues: string[];
};

function createNoopResult(): SystemMessageRectifierResult {
  return {
    applied: false,
    movedCount: 0,
    extractedValues: [],
  };
}

type TextBlock = { type: "text"; text: string; [key: string]: unknown };

function isTextBlock(block: unknown): block is TextBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as Record<string, unknown>).type === "text" &&
    typeof (block as Record<string, unknown>).text === "string"
  );
}

/**
 * Convert the content of a `role: "system"` message into text blocks suitable for
 * the top-level `system` array. String content becomes a single text block; array
 * content keeps its text blocks as-is (preserving extra fields like cache_control)
 * and drops non-text blocks, which are not valid in a system prompt anyway.
 */
function contentToTextBlocks(content: unknown): TextBlock[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }
  if (Array.isArray(content)) {
    return content.filter(isTextBlock);
  }
  return [];
}

/**
 * Move `role: "system"` entries out of the `messages` array and append their text
 * content to the top-level `system` field. Mutates the message object in place
 * (matches existing rectifier conventions).
 */
export function rectifySystemMessages(
  message: Record<string, unknown>
): SystemMessageRectifierResult {
  const messages = message.messages;
  if (!Array.isArray(messages)) {
    return createNoopResult();
  }

  const extractedBlocks: TextBlock[] = [];
  const extractedValues: string[] = [];
  const remaining: unknown[] = [];
  let movedCount = 0;

  for (const entry of messages) {
    if (
      entry &&
      typeof entry === "object" &&
      (entry as Record<string, unknown>).role === "system"
    ) {
      movedCount++;
      const blocks = contentToTextBlocks((entry as Record<string, unknown>).content);
      extractedBlocks.push(...blocks);
      extractedValues.push(...blocks.map((block) => block.text));
    } else {
      remaining.push(entry);
    }
  }

  if (movedCount === 0) {
    return createNoopResult();
  }

  // Mutate in place: replace messages array contents
  messages.length = 0;
  for (const entry of remaining) {
    messages.push(entry);
  }

  if (extractedBlocks.length > 0) {
    const system = message.system;
    if (system === undefined || system === null) {
      message.system = extractedBlocks;
    } else if (typeof system === "string") {
      const head: TextBlock[] = system.length > 0 ? [{ type: "text", text: system }] : [];
      message.system = [...head, ...extractedBlocks];
    } else if (Array.isArray(system)) {
      system.push(...extractedBlocks);
    } else {
      // Unknown system type: replace with extracted blocks to avoid dropping content
      message.system = extractedBlocks;
    }
  }

  return { applied: true, movedCount, extractedValues };
}
