export interface GeminiContent {
  role: "user" | "model";
  parts: {
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    };
    functionCall?: {
      name: string;
      args: Record<string, unknown>;
    };
    functionResponse?: {
      name: string;
      response: Record<string, unknown>;
    };
  }[];
}

export interface GeminiSafetySetting {
  category: string;
  threshold: string;
}

export interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  candidateCount?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  responseMimeType?: string;
}

export interface GeminiTool {
  functionDeclarations?: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>; // Officially parameters, but translated to parametersJsonSchema for CLI if needed? No, official uses parameters.
  }[];
}

export interface GeminiRequest {
  contents: GeminiContent[];
  tools?: GeminiTool[];
  safetySettings?: GeminiSafetySetting[];
  generationConfig?: GeminiGenerationConfig;
  systemInstruction?: {
    role?: "user";
    parts: { text: string }[];
  };
}

export interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  cachedContentTokenCount?: number; // Gemini 缓存支持
}

export interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: string;
  citationMetadata?: {
    citationSources: {
      startIndex: number;
      endIndex: number;
      uri: string;
      license: string;
    }[];
  };
}

export interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: {
    blockReason?: string;
  };
  usageMetadata?: GeminiUsageMetadata;
}
