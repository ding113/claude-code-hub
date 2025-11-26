/**
 * Default Test Prompts for Provider Testing
 * Based on relay-pulse exact patterns
 *
 * These are minimal request bodies designed to:
 * 1. Minimize token consumption (small prompts, low max_tokens)
 * 2. Provide reliable content validation ("pong" response)
 * 3. Support both streaming and non-streaming modes
 */

import type { ProviderType } from '@/types/provider';
import type {
  ClaudeTestBody,
  CodexTestBody,
  OpenAITestBody,
  GeminiTestBody,
} from '../types';

// ============================================================================
// Claude / Claude-Auth Test Body
// ============================================================================

/**
 * Claude Messages API test request body
 * - Uses claude-sonnet-4-5-20250929 as default model
 * - Non-streaming for faster response validation
 * - Minimal token usage with echo bot pattern
 */
export const CLAUDE_TEST_BODY: ClaudeTestBody = {
  model: 'claude-sonnet-4-5-20250929',
  messages: [
    {
      role: 'user',
      content: [{ type: 'text', text: 'ping, please reply pong' }],
    },
  ],
  system: [
    {
      type: 'text',
      text: 'You are a echo bot. Always say pong.',
      cache_control: { type: 'ephemeral' },
    },
  ],
  max_tokens: 20,
  stream: false,
  metadata: { user_id: 'cch_probe_test' },
};

/**
 * Headers for Claude API
 */
export const CLAUDE_TEST_HEADERS = {
  'anthropic-version': '2023-06-01',
  'content-type': 'application/json',
};

// ============================================================================
// Codex Test Body (Response API format)
// ============================================================================

/**
 * Codex Response API test request body
 * - Uses gpt-5-codex as default model
 * - Streaming enabled (Codex typically streams)
 * - Low reasoning effort for faster response
 */
export const CODEX_TEST_BODY: CodexTestBody = {
  model: 'gpt-5-codex',
  instructions: 'You are a echo bot. Always say pong.',
  input: [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'ping' }],
    },
  ],
  tools: [],
  tool_choice: 'auto',
  reasoning: { effort: 'low', summary: 'auto' },
  store: false,
  stream: true,
};

/**
 * Headers for Codex API (uses Bearer token)
 */
export const CODEX_TEST_HEADERS = {
  'content-type': 'application/json',
};

// ============================================================================
// OpenAI-Compatible Test Body
// ============================================================================

/**
 * OpenAI Chat Completions test request body
 * - Uses gpt-4o as default model
 * - Non-streaming for simpler validation
 */
export const OPENAI_TEST_BODY: OpenAITestBody = {
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: 'You are a echo bot. Always say pong.' },
    { role: 'user', content: 'ping' },
  ],
  max_tokens: 20,
  stream: false,
};

/**
 * Headers for OpenAI-Compatible API (uses Bearer token)
 */
export const OPENAI_TEST_HEADERS = {
  'content-type': 'application/json',
};

// ============================================================================
// Gemini Test Body
// ============================================================================

/**
 * Gemini GenerateContent test request body
 * - Uses gemini-2.0-flash as default model
 * - Simple content structure
 */
export const GEMINI_TEST_BODY: GeminiTestBody = {
  contents: [
    {
      parts: [{ text: 'ping, please reply pong' }],
    },
  ],
  systemInstruction: {
    parts: [{ text: 'You are a echo bot. Always say pong.' }],
  },
  generationConfig: {
    maxOutputTokens: 20,
  },
};

/**
 * Headers for Gemini API
 */
export const GEMINI_TEST_HEADERS = {
  'content-type': 'application/json',
};

// ============================================================================
// Provider Type Mappings
// ============================================================================

/**
 * Default models per provider type
 */
export const DEFAULT_MODELS: Record<ProviderType, string> = {
  claude: 'claude-sonnet-4-5-20250929',
  'claude-auth': 'claude-sonnet-4-5-20250929',
  codex: 'gpt-5-codex',
  'openai-compatible': 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  'gemini-cli': 'gemini-2.0-flash',
};

/**
 * Default success_contains patterns per provider type
 */
export const DEFAULT_SUCCESS_CONTAINS: Record<ProviderType, string> = {
  claude: 'pong',
  'claude-auth': 'pong',
  codex: 'pong',
  'openai-compatible': 'pong',
  gemini: 'pong',
  'gemini-cli': 'pong',
};

/**
 * API endpoints per provider type
 */
export const API_ENDPOINTS: Record<ProviderType, string> = {
  claude: '/v1/messages',
  'claude-auth': '/v1/messages',
  codex: '/v1/responses',
  'openai-compatible': '/v1/chat/completions',
  gemini: '/v1beta/models/{model}:generateContent',
  'gemini-cli': '/v1beta/models/{model}:generateContent',
};

/**
 * Get test body for a specific provider type
 */
export function getTestBody(
  providerType: ProviderType,
  model?: string
): Record<string, unknown> {
  const targetModel = model || DEFAULT_MODELS[providerType];

  switch (providerType) {
    case 'claude':
    case 'claude-auth':
      return { ...CLAUDE_TEST_BODY, model: targetModel };

    case 'codex':
      return { ...CODEX_TEST_BODY, model: targetModel };

    case 'openai-compatible':
      return { ...OPENAI_TEST_BODY, model: targetModel };

    case 'gemini':
    case 'gemini-cli':
      // Gemini model is in URL, not body
      return { ...GEMINI_TEST_BODY };

    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }
}

/**
 * Get test headers for a specific provider type
 */
export function getTestHeaders(
  providerType: ProviderType,
  apiKey: string
): Record<string, string> {
  switch (providerType) {
    case 'claude':
      return {
        ...CLAUDE_TEST_HEADERS,
        'x-api-key': apiKey,
      };

    case 'claude-auth':
      // Claude-auth uses Bearer token
      return {
        ...CLAUDE_TEST_HEADERS,
        Authorization: `Bearer ${apiKey}`,
      };

    case 'codex':
    case 'openai-compatible':
      return {
        ...OPENAI_TEST_HEADERS,
        Authorization: `Bearer ${apiKey}`,
      };

    case 'gemini':
    case 'gemini-cli':
      // Gemini uses URL parameter for API key
      return {
        ...GEMINI_TEST_HEADERS,
      };

    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }
}

/**
 * Get the full test URL for a provider
 */
export function getTestUrl(
  baseUrl: string,
  providerType: ProviderType,
  model?: string,
  apiKey?: string
): string {
  // Remove trailing slash
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const endpoint = API_ENDPOINTS[providerType];
  const targetModel = model || DEFAULT_MODELS[providerType];

  let url = `${cleanBaseUrl}${endpoint}`;

  // Gemini needs model in URL
  if (providerType === 'gemini' || providerType === 'gemini-cli') {
    url = url.replace('{model}', targetModel);
    // Add API key as query parameter for Gemini
    if (apiKey) {
      url += `?key=${apiKey}`;
    }
  }

  return url;
}
