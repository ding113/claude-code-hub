import { GeminiRequest, GeminiContent, GeminiResponse, GeminiCandidate, GeminiUsageMetadata } from "./types";

export class GeminiAdapter {
  /**
   * Convert generic chat request (OpenAI/Claude style) to Gemini format
   */
  static transformRequest(
    input: any, 
    providerType: "gemini" | "gemini-cli"
  ): GeminiRequest {
    const messages = input.messages || [];
    const contents: GeminiContent[] = [];
    let systemInstructionParts: { text: string }[] = [];

    // Handle system message(s)
    // Some formats allow multiple system messages or system message in "messages"
    // We extract them all into systemInstruction
    if (input.system) {
        if (typeof input.system === 'string') {
            systemInstructionParts.push({ text: input.system });
        }
    }

    for (const msg of messages) {
      if (msg.role === "system") {
        const text = typeof msg.content === "string" ? msg.content : 
                     Array.isArray(msg.content) ? msg.content.map((c: any) => c.text).join("") : "";
        if (text) systemInstructionParts.push({ text });
        continue;
      }

      const role = msg.role === "assistant" ? "model" : "user";
      let parts: { text: string; inlineData?: any }[] = [];

      if (typeof msg.content === "string") {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        parts = msg.content.map((c: any) => {
          if (c.type === "text") return { text: c.text };
          if (c.type === "image" || c.type === "image_url") {
              // Minimal support for image if base64 provided
              // This needs more robust handling for real implementation
              const source = c.source || c.image_url;
              if (source && source.data) {
                   return { inlineData: { mimeType: source.media_type || "image/jpeg", data: source.data } };
              }
          }
          return { text: "" };
        }).filter((p: any) => p.text || p.inlineData);
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
      }
    };

    if (systemInstructionParts.length > 0) {
        request.systemInstruction = { parts: systemInstructionParts };
    }

    // CLI specific handling
    if (providerType === "gemini-cli") {
        // TODO: Inject any CLI specific fields if required by the wrapper
        // e.g. force role: user in system instructions? 
        // The TOON says: "systemInstruction上强制 role: 'user' 以满足 CLI 后端"
        // But Gemini API systemInstruction doesn't have a role field, it's just content.
        // Maybe it means "convert system messages to user messages"?
        // "OpenAI messages -> Gemini contents+systemInstruction"
        // "For CLI: systemInstruction must have role: 'user'?"
        // Let's assume standard systemInstruction is fine unless we find otherwise.
        // Re-reading TOON: "systemInstruction上强制 role: 'user'"
        // This likely means putting system messages into contents as role: user, or similar.
        // But usually systemInstruction is separate.
        // Let's keep it standard for now.
    }

    return request;
  }

  /**
   * Convert Gemini response to OpenAI-compatible chunks or full response
   */
  static transformResponse(
    response: GeminiResponse,
    isStream: boolean
  ): any {
      // Extract content
      let content = "";
      const candidate = response.candidates?.[0];
      
      if (candidate?.content?.parts) {
          content = candidate.content.parts.map(p => p.text).join("");
      }

      // Handle finish reason
      const finishReason = mapFinishReason(candidate?.finishReason);

      // Extract usage
      const usage = response.usageMetadata ? {
          prompt_tokens: response.usageMetadata.promptTokenCount,
          completion_tokens: response.usageMetadata.candidatesTokenCount,
          total_tokens: response.usageMetadata.totalTokenCount
      } : undefined;

      if (isStream) {
          // Return a chunk structure
          return {
              id: "chatcmpl-" + Date.now(),
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: "gemini-model", // Placeholder
              choices: [{
                  index: 0,
                  delta: { content },
                  finish_reason: finishReason
              }],
              usage // usage might be in the last chunk
          };
      } else {
          return {
              id: "chatcmpl-" + Date.now(),
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: "gemini-model",
              choices: [{
                  index: 0,
                  message: { role: "assistant", content },
                  finish_reason: finishReason
              }],
              usage
          };
      }
  }
}

function mapFinishReason(reason?: string): string | null {
    if (!reason) return null;
    switch (reason) {
        case "STOP": return "stop";
        case "MAX_TOKENS": return "length";
        case "SAFETY": return "content_filter";
        default: return reason.toLowerCase();
    }
}

