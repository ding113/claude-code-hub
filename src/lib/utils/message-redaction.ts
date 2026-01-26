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
 * Redact Gemini parts array (text, inlineData, functionCall)
 */
function redactGeminiParts(parts: unknown[]): unknown[] {
  return parts.map((part) => {
    if (!isPlainObject(part)) return part;

    const redactedPart = { ...part };

    // Redact text content
    if ("text" in redactedPart && typeof redactedPart.text === "string") {
      redactedPart.text = REDACTED_MARKER;
    }

    // Redact inlineData.data (base64 image data)
    if ("inlineData" in redactedPart && isPlainObject(redactedPart.inlineData)) {
      const inlineData = redactedPart.inlineData as Record<string, unknown>;
      if ("data" in inlineData) {
        redactedPart.inlineData = { ...inlineData, data: REDACTED_MARKER };
      }
    }

    // Redact functionCall.args
    if ("functionCall" in redactedPart && isPlainObject(redactedPart.functionCall)) {
      const functionCall = redactedPart.functionCall as Record<string, unknown>;
      if ("args" in functionCall) {
        redactedPart.functionCall = { ...functionCall, args: REDACTED_MARKER };
      }
    }

    // Redact functionResponse.response
    if ("functionResponse" in redactedPart && isPlainObject(redactedPart.functionResponse)) {
      const functionResponse = redactedPart.functionResponse as Record<string, unknown>;
      if ("response" in functionResponse) {
        redactedPart.functionResponse = { ...functionResponse, response: REDACTED_MARKER };
      }
    }

    return redactedPart;
  });
}

/**
 * Redact Gemini contents array
 */
function redactGeminiContents(contents: unknown[]): unknown[] {
  return contents.map((content) => {
    if (!isPlainObject(content)) return content;

    const redactedContent = { ...content };

    if ("parts" in redactedContent && Array.isArray(redactedContent.parts)) {
      redactedContent.parts = redactGeminiParts(redactedContent.parts);
    }

    return redactedContent;
  });
}

/**
 * Redact Gemini systemInstruction
 */
function redactGeminiSystemInstruction(systemInstruction: unknown): unknown {
  if (!isPlainObject(systemInstruction)) return systemInstruction;

  const result = { ...systemInstruction };

  if ("parts" in result && Array.isArray(result.parts)) {
    result.parts = redactGeminiParts(result.parts);
  }

  return result;
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

  // Redact messages array (Claude/OpenAI format)
  if ("messages" in result && Array.isArray(result.messages)) {
    result.messages = redactMessagesArray(result.messages);
  }

  // Redact system prompt (Claude format)
  if ("system" in result) {
    result.system = redactSystemPrompt(result.system);
  }

  // Redact input array (Response API format)
  if ("input" in result && Array.isArray(result.input)) {
    result.input = redactMessagesArray(result.input);
  }

  // Redact Gemini contents[] format
  if ("contents" in result && Array.isArray(result.contents)) {
    result.contents = redactGeminiContents(result.contents);
  }

  // Redact Gemini CLI wrapper format: request.contents[] and request.systemInstruction
  if ("request" in result && isPlainObject(result.request)) {
    const request = { ...result.request } as Record<string, unknown>;

    if ("contents" in request && Array.isArray(request.contents)) {
      request.contents = redactGeminiContents(request.contents);
    }

    if ("systemInstruction" in request) {
      request.systemInstruction = redactGeminiSystemInstruction(request.systemInstruction);
    }

    result.request = request;
  }

  return result;
}

/**
 * Redact OpenAI choices array (message.content or delta.content)
 */
function redactOpenAIChoices(choices: unknown[]): unknown[] {
  return choices.map((choice) => {
    if (!isPlainObject(choice)) return choice;

    const redactedChoice = { ...choice };

    // Redact message.content (non-streaming)
    if ("message" in redactedChoice && isPlainObject(redactedChoice.message)) {
      const message = { ...redactedChoice.message } as Record<string, unknown>;
      if ("content" in message && typeof message.content === "string") {
        message.content = REDACTED_MARKER;
      }
      // Redact reasoning_content if present
      if ("reasoning_content" in message && typeof message.reasoning_content === "string") {
        message.reasoning_content = REDACTED_MARKER;
      }
      // Redact tool_calls arguments
      if ("tool_calls" in message && Array.isArray(message.tool_calls)) {
        message.tool_calls = (message.tool_calls as unknown[]).map((tc) => {
          if (!isPlainObject(tc)) return tc;
          const redactedTc = { ...tc };
          if ("function" in redactedTc && isPlainObject(redactedTc.function)) {
            const fn = redactedTc.function as Record<string, unknown>;
            if ("arguments" in fn) {
              redactedTc.function = { ...fn, arguments: REDACTED_MARKER };
            }
          }
          return redactedTc;
        });
      }
      redactedChoice.message = message;
    }

    // Redact delta.content (streaming)
    if ("delta" in redactedChoice && isPlainObject(redactedChoice.delta)) {
      const delta = { ...redactedChoice.delta } as Record<string, unknown>;
      if ("content" in delta && typeof delta.content === "string") {
        delta.content = REDACTED_MARKER;
      }
      if ("reasoning_content" in delta && typeof delta.reasoning_content === "string") {
        delta.reasoning_content = REDACTED_MARKER;
      }
      redactedChoice.delta = delta;
    }

    return redactedChoice;
  });
}

/**
 * Redact Claude content blocks in response
 */
function redactClaudeContentBlocks(content: unknown[]): unknown[] {
  return content.map((block) => {
    if (!isPlainObject(block)) return block;

    const redactedBlock = { ...block };

    // Redact text content
    if ("text" in redactedBlock && typeof redactedBlock.text === "string") {
      redactedBlock.text = REDACTED_MARKER;
    }

    // Redact thinking content
    if ("thinking" in redactedBlock && typeof redactedBlock.thinking === "string") {
      redactedBlock.thinking = REDACTED_MARKER;
    }

    // Redact tool_use input
    if ("input" in redactedBlock) {
      redactedBlock.input = REDACTED_MARKER;
    }

    return redactedBlock;
  });
}

/**
 * Redact Codex response.output[] items
 */
function redactCodexOutput(output: unknown[]): unknown[] {
  return output.map((item) => {
    if (!isPlainObject(item)) return item;

    const redactedItem = { ...item };
    const itemType = redactedItem.type as string;

    // Redact message content
    if (
      itemType === "message" &&
      "content" in redactedItem &&
      Array.isArray(redactedItem.content)
    ) {
      redactedItem.content = (redactedItem.content as unknown[]).map((c) => {
        if (!isPlainObject(c)) return c;
        const redactedC = { ...c };
        if ("text" in redactedC && typeof redactedC.text === "string") {
          redactedC.text = REDACTED_MARKER;
        }
        return redactedC;
      });
    }

    // Redact reasoning summary
    if (
      itemType === "reasoning" &&
      "summary" in redactedItem &&
      Array.isArray(redactedItem.summary)
    ) {
      redactedItem.summary = (redactedItem.summary as unknown[]).map((s) => {
        if (!isPlainObject(s)) return s;
        const redactedS = { ...s };
        if ("text" in redactedS && typeof redactedS.text === "string") {
          redactedS.text = REDACTED_MARKER;
        }
        return redactedS;
      });
    }

    // Redact function_call arguments
    if (itemType === "function_call" && "arguments" in redactedItem) {
      redactedItem.arguments = REDACTED_MARKER;
    }

    return redactedItem;
  });
}

/**
 * Redact Gemini candidates array in response
 */
function redactGeminiCandidates(candidates: unknown[]): unknown[] {
  return candidates.map((candidate) => {
    if (!isPlainObject(candidate)) return candidate;

    const redactedCandidate = { ...candidate };

    if ("content" in redactedCandidate && isPlainObject(redactedCandidate.content)) {
      const content = { ...redactedCandidate.content } as Record<string, unknown>;
      if ("parts" in content && Array.isArray(content.parts)) {
        content.parts = redactGeminiParts(content.parts);
      }
      redactedCandidate.content = content;
    }

    return redactedCandidate;
  });
}

/**
 * Redact message content in a response body object
 *
 * @param body - The response body object (parsed JSON)
 * @returns A new object with message content redacted
 */
export function redactResponseBody(body: unknown): unknown {
  if (!isPlainObject(body)) {
    return body;
  }

  const result = { ...body };

  // Redact OpenAI choices[] (message.content or delta.content)
  if ("choices" in result && Array.isArray(result.choices)) {
    result.choices = redactOpenAIChoices(result.choices);
  }

  // Redact Claude content[] blocks (response format)
  if ("content" in result && Array.isArray(result.content)) {
    result.content = redactClaudeContentBlocks(result.content);
  }

  // Redact Gemini candidates[].content.parts[]
  if ("candidates" in result && Array.isArray(result.candidates)) {
    result.candidates = redactGeminiCandidates(result.candidates);
  }

  // Redact Codex response.output[] (wrapped format)
  if ("response" in result && isPlainObject(result.response)) {
    const response = { ...result.response } as Record<string, unknown>;

    if ("output" in response && Array.isArray(response.output)) {
      response.output = redactCodexOutput(response.output);
    }

    // Redact Gemini CLI wrapped response: response.candidates[]
    if ("candidates" in response && Array.isArray(response.candidates)) {
      response.candidates = redactGeminiCandidates(response.candidates);
    }

    result.response = response;
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
