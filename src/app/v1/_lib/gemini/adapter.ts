import type { GeminiContent, GeminiRequest, GeminiResponse } from "./types";

// Define input message types for request transformation
interface ContentPart {
  type?: string;
  text?: string;
  source?: { media_type?: string; data?: string; url?: string };
  image_url?: { media_type?: string; data?: string; url?: string };
}

interface InputMessage {
  role: string;
  content: string | ContentPart[] | { text?: string; parts?: ContentPart[] };
}

interface TransformInput {
  messages?: InputMessage[];
  system?: string | string[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop_sequences?: string[];
}

// Define OpenAI-compatible response types
interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  // Extended fields for Gemini cache support
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface OpenAICompatibleResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta?: { content: string };
    message?: { role: string; content: string };
    finish_reason: string | null;
  }>;
  usage?: OpenAIUsage;
}

/**
 * Extract text content from various message content formats
 * Supports:
 * - Simple string: "hello"
 * - Array format: [{type: "text", text: "hello"}]
 * - Object format: {text: "hello"} or {parts: [{text: "hello"}]}
 */
function extractTextContent(
  content: string | ContentPart[] | { text?: string; parts?: ContentPart[] }
): string {
  // Simple string
  if (typeof content === "string") {
    return content;
  }

  // Object with text field: {text: "hello"}
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const obj = content as { text?: string; parts?: ContentPart[] };
    if (obj.text) {
      return obj.text;
    }
    // Object with parts: {parts: [{text: "hello"}]}
    if (Array.isArray(obj.parts)) {
      return obj.parts.map((p) => p.text || "").join("");
    }
  }

  // Array format: [{type: "text", text: "hello"}]
  if (Array.isArray(content)) {
    return content.map((c: ContentPart) => c.text || "").join("");
  }

  return "";
}

export class GeminiAdapter {
  /**
   * Convert generic chat request (OpenAI/Claude style) to Gemini format
   */
  static transformRequest(
    input: TransformInput,
    providerType: "gemini" | "gemini-cli"
  ): GeminiRequest {
    const messages = input.messages || [];
    const contents: GeminiContent[] = [];
    const systemInstructionParts: { text: string }[] = [];

    // Handle system message(s)
    if (input.system) {
      if (typeof input.system === "string") {
        systemInstructionParts.push({ text: input.system });
      } else if (Array.isArray(input.system)) {
        // Support array of system messages
        for (const sys of input.system) {
          if (typeof sys === "string" && sys) {
            systemInstructionParts.push({ text: sys });
          }
        }
      }
    }

    for (const msg of messages) {
      if (msg.role === "system") {
        const text = extractTextContent(msg.content);
        if (text) systemInstructionParts.push({ text });
        continue;
      }

      const role = msg.role === "assistant" ? "model" : "user";
      const parts: { text: string; inlineData?: { mimeType: string; data: string } }[] = [];

      // Handle string content
      if (typeof msg.content === "string") {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Handle array of content parts
        for (const c of msg.content) {
          if ((c.type === "text" || !c.type) && c.text) {
            parts.push({ text: c.text });
          } else if (c.type === "image" || c.type === "image_url") {
            // Handle image content
            const source = c.source || c.image_url;
            if (source) {
              // Support both base64 data and URLs
              if (source.data) {
                parts.push({
                  text: "",
                  inlineData: {
                    mimeType: source.media_type || "image/jpeg",
                    data: source.data,
                  },
                });
              } else if (source.url) {
                // For URL-based images, we'd need to fetch and convert to base64
                // For now, just add a text placeholder
                parts.push({ text: `[Image: ${source.url}]` });
              }
            }
          }
        }
      } else if (msg.content && typeof msg.content === "object") {
        // Handle object content: {text: "hello"} or {parts: [{text: "hello"}]}
        const text = extractTextContent(msg.content);
        if (text) {
          parts.push({ text });
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    // Construct request
    const request: GeminiRequest = {
      contents,
      generationConfig: {
        temperature: input.temperature,
        topP: input.top_p,
        maxOutputTokens: input.max_tokens,
        stopSequences: input.stop_sequences,
      },
    };

    if (systemInstructionParts.length > 0) {
      // Gemini CLI may require role: 'user' in systemInstruction
      // Standard Gemini API doesn't use role in systemInstruction
      request.systemInstruction =
        providerType === "gemini-cli"
          ? { role: "user", parts: systemInstructionParts }
          : { parts: systemInstructionParts };
    }

    return request;
  }

  /**
   * Convert Gemini response to OpenAI-compatible chunks or full response
   * Handles response wrapping: some providers wrap response in {response: {...}}
   */
  static transformResponse(response: GeminiResponse, isStream: boolean): OpenAICompatibleResponse {
    // Handle response wrapping (some providers return {response: {...}})
    const actualResponse = (response as { response?: GeminiResponse }).response || response;

    // Extract content
    let content = "";
    const candidate = actualResponse.candidates?.[0];

    if (candidate?.content?.parts) {
      content = candidate.content.parts.map((p) => p.text || "").join("");
    }

    // Handle finish reason
    const finishReason = mapFinishReason(candidate?.finishReason);

    // Extract usage - handle both usageMetadata and usage fields
    const usageData =
      actualResponse.usageMetadata ||
      (
        actualResponse as {
          usage?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            totalTokenCount?: number;
            cachedContentTokenCount?: number;
          };
        }
      ).usage;
    const usage = usageData
      ? {
          prompt_tokens: usageData.promptTokenCount || 0,
          completion_tokens: usageData.candidatesTokenCount || 0,
          total_tokens: usageData.totalTokenCount || 0,
          // Gemini 缓存支持：仅在存在缓存读取时添加字段
          ...(typeof usageData.cachedContentTokenCount === "number" &&
          usageData.cachedContentTokenCount > 0
            ? { cache_read_input_tokens: usageData.cachedContentTokenCount }
            : {}),
        }
      : undefined;

    if (isStream) {
      // Return a chunk structure
      return {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "gemini-model", // Placeholder
        choices: [
          {
            index: 0,
            delta: { content },
            finish_reason: finishReason,
          },
        ],
        usage, // usage might be in the last chunk
      };
    } else {
      return {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "gemini-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: finishReason,
          },
        ],
        usage,
      };
    }
  }
}

function mapFinishReason(reason?: string): string | null {
  if (!reason) return null;
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
      return "content_filter";
    default:
      return reason.toLowerCase();
  }
}
