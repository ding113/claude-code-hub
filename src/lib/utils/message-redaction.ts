/**
 * Message Content Redaction Utility
 *
 * Redacts message content in API request/response bodies to protect user privacy.
 * Replaces messages[].content with [REDACTED] while preserving structure.
 */

const REDACTED_MARKER = "[REDACTED]";

/**
 * Check if a value is a plain object
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Redact content field in a message block
 */
function redactMessageContent(message: Record<string, unknown>): Record<string, unknown> {
  const result = { ...message };

  // Redact string content
  if (typeof result.content === "string") {
    result.content = REDACTED_MARKER;
    return result;
  }

  // Redact array content (content blocks)
  if (Array.isArray(result.content)) {
    result.content = result.content.map((block) => {
      if (typeof block === "string") {
        return REDACTED_MARKER;
      }

      if (isPlainObject(block)) {
        const redactedBlock = { ...block };

        // Redact text content in text blocks
        if ("text" in redactedBlock && typeof redactedBlock.text === "string") {
          redactedBlock.text = REDACTED_MARKER;
        }

        // Redact source data in image blocks
        if ("source" in redactedBlock && isPlainObject(redactedBlock.source)) {
          const source = redactedBlock.source as Record<string, unknown>;
          if ("data" in source) {
            redactedBlock.source = { ...source, data: REDACTED_MARKER };
          }
        }

        // Redact input in tool_use blocks
        if ("input" in redactedBlock) {
          redactedBlock.input = REDACTED_MARKER;
        }

        // Redact content in tool_result blocks
        if ("content" in redactedBlock) {
          if (typeof redactedBlock.content === "string") {
            redactedBlock.content = REDACTED_MARKER;
          } else if (Array.isArray(redactedBlock.content)) {
            redactedBlock.content = redactedBlock.content.map((item) => {
              if (typeof item === "string") return REDACTED_MARKER;
              if (isPlainObject(item) && "text" in item) {
                return { ...item, text: REDACTED_MARKER };
              }
              return item;
            });
          }
        }

        return redactedBlock;
      }

      return block;
    });
  }

  return result;
}

/**
 * Redact messages array in request body
 */
function redactMessagesArray(messages: unknown[]): unknown[] {
  return messages.map((msg) => {
    if (!isPlainObject(msg)) return msg;
    return redactMessageContent(msg);
  });
}

/**
 * Redact system prompt content
 */
function redactSystemPrompt(system: unknown): unknown {
  if (typeof system === "string") {
    return REDACTED_MARKER;
  }

  if (Array.isArray(system)) {
    return system.map((block) => {
      if (typeof block === "string") return REDACTED_MARKER;
      if (isPlainObject(block) && "text" in block) {
        return { ...block, text: REDACTED_MARKER };
      }
      return block;
    });
  }

  return system;
}

/**
 * Redact message content in a request body object
 *
 * @param body - The request body object (parsed JSON)
 * @returns A new object with message content redacted
 */
export function redactRequestBody(body: unknown): unknown {
  if (!isPlainObject(body)) {
    return body;
  }

  const result = { ...body };

  // Redact messages array
  if ("messages" in result && Array.isArray(result.messages)) {
    result.messages = redactMessagesArray(result.messages);
  }

  // Redact system prompt
  if ("system" in result) {
    result.system = redactSystemPrompt(result.system);
  }

  // Redact input array (Response API format)
  if ("input" in result && Array.isArray(result.input)) {
    result.input = redactMessagesArray(result.input);
  }

  return result;
}

/**
 * Redact message content in a JSON string
 *
 * @param jsonString - The JSON string to redact
 * @returns A new JSON string with message content redacted
 */
export function redactJsonString(jsonString: string): string {
  try {
    const parsed = JSON.parse(jsonString);
    const redacted = redactRequestBody(parsed);
    return JSON.stringify(redacted, null, 2);
  } catch {
    // If parsing fails, return original string
    return jsonString;
  }
}

/**
 * Redact messages array for display
 *
 * @param messages - The messages array
 * @returns A new array with content redacted
 */
export function redactMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) {
    return messages;
  }
  return redactMessagesArray(messages);
}

export { REDACTED_MARKER };
