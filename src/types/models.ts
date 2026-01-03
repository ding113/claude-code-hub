/**
 * 模型列表响应类型定义
 * 支持 OpenAI、Anthropic、Gemini 三种格式
 */

// OpenAI 模型列表响应
export interface OpenAIModelsResponse {
  object: "list";
  data: OpenAIModel[];
}

export interface OpenAIModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

// Anthropic 模型列表响应
export interface AnthropicModelsResponse {
  data: AnthropicModel[];
  has_more: boolean;
}

export interface AnthropicModel {
  id: string;
  type: "model";
  display_name: string;
  created_at: string;
}

// Gemini 模型列表响应
export interface GeminiModelsResponse {
  models: GeminiModel[];
}

export interface GeminiModel {
  name: string;
  displayName: string;
  supportedGenerationMethods: string[];
}
