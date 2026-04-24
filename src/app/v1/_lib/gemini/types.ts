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

export interface GeminiTokenDetail {
  modality: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO";
  tokenCount: number;
}

export interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  cachedContentTokenCount?: number; // Gemini 缓存命中的 token 数
  thoughtsTokenCount?: number; // Gemini 思考模型的推理 token
  // 详细信息（按 modality 分类）
  promptTokensDetails?: GeminiTokenDetail[];
  cacheTokensDetails?: GeminiTokenDetail[];
  candidatesTokensDetails?: GeminiTokenDetail[];
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
  /**
   * 上游 Gemini API 返回的实际模型版本(GenerateContentResponse.modelVersion)。
   * 由于 Gemini 请求模型名放在 URL path 里,响应里的 modelVersion 才是权威的真实模型。
   */
  modelVersion?: string;
  /** 官方 SDK 的 snake_case 别名,保持兼容 */
  model_version?: string;
  responseId?: string;
}
