/**
 * Default Test Prompts for Provider Testing
 *
 * 这里保留协议级兜底默认值；真正执行时会优先使用 presets.ts 里的模板定义。
 */

import type { ProviderType } from "@/types/provider";
import type { ClaudeTestBody, CodexTestBody, GeminiTestBody, OpenAITestBody } from "../types";

export const USER_AGENTS: Record<ProviderType, string> = {
  claude: "claude-cli/2.1.84 (external, cli)",
  "claude-auth": "claude-cli/2.1.84 (external, cli)",
  codex: "Codex-CLI/1.0",
  "openai-compatible": "OpenAI-Compatible/2026.04",
  gemini: "GeminiCLI/v24.11.0 (linux; x64)",
  "gemini-cli": "GeminiCLI/v24.11.0 (linux; x64)",
};

export const BASE_HEADERS = {
  Accept: "application/json, text/event-stream",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  Connection: "keep-alive",
};

export const CLAUDE_TEST_BODY: ClaudeTestBody = {
  model: "claude-haiku-4-5-20251001",
  max_tokens: 20,
  stream: true,
  metadata: { user_id: "cch_probe_test" },
  system: [
    {
      type: "text",
      text: "You are Claude Code, Anthropic's official CLI for Claude.",
    },
  ],
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: "ping, please reply 'pong'" }],
    },
  ],
};

export const CODEX_TEST_BODY: CodexTestBody = {
  model: "gpt-5.3-codex",
  instructions:
    "You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer.",
  input: [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "ping" }],
    },
  ],
  tools: [],
  tool_choice: "auto",
  parallel_tool_calls: false,
  reasoning: { effort: "low", summary: "auto" },
  store: false,
  stream: true,
};

export const OPENAI_TEST_BODY: OpenAITestBody = {
  model: "gpt-4.1-mini",
  messages: [
    { role: "system", content: "You are an echo bot. Reply with exactly pong." },
    { role: "user", content: "ping" },
  ],
  max_tokens: 20,
  stream: false,
};

export const GEMINI_TEST_BODY: GeminiTestBody = {
  contents: [
    {
      role: "user",
      parts: [{ text: "ping" }],
    },
  ],
  generationConfig: {
    temperature: 0,
    maxOutputTokens: 256,
    thinkingConfig: {
      thinkingBudget: 0,
    },
  },
};

export const CLAUDE_TEST_HEADERS = {
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
};

export const CODEX_TEST_HEADERS = {
  "content-type": "application/json",
  "openai-beta": "responses=experimental",
};

export const OPENAI_TEST_HEADERS = {
  "content-type": "application/json",
};

export const GEMINI_TEST_HEADERS = {
  "content-type": "application/json",
  "x-goog-api-client": "google-genai-sdk/1.30.0 gl-node/v24.11.0",
};

export const DEFAULT_MODELS: Record<ProviderType, string> = {
  claude: "claude-haiku-4-5-20251001",
  "claude-auth": "claude-haiku-4-5-20251001",
  codex: "gpt-5.3-codex",
  "openai-compatible": "gpt-4.1-mini",
  gemini: "gemini-2.5-flash",
  "gemini-cli": "gemini-2.5-flash",
};

export const DEFAULT_SUCCESS_CONTAINS: Record<ProviderType, string> = {
  claude: "pong",
  "claude-auth": "pong",
  codex: "pong",
  "openai-compatible": "pong",
  gemini: "pong",
  "gemini-cli": "pong",
};

export const API_ENDPOINTS: Record<ProviderType, string> = {
  claude: "/v1/messages",
  "claude-auth": "/v1/messages",
  codex: "/v1/responses",
  "openai-compatible": "/v1/chat/completions",
  gemini: "/v1beta/models/{model}:generateContent",
  "gemini-cli": "/v1beta/models/{model}:generateContent",
};

function looksLikeAnthropicProxy(providerUrl?: string): boolean {
  if (!providerUrl) {
    return false;
  }

  try {
    const hostname = new URL(providerUrl).hostname.toLowerCase();
    if (hostname.endsWith("anthropic.com") || hostname.endsWith("claude.ai")) {
      return false;
    }
    // 只匹配常见 relay/proxy 标识，避免把普通业务域名里的 “gpt” 误识别成代理层。
    return /(?:^|[.-])(proxy|relay|gateway|router|worker|openrouter|api2d|oaipro)(?:[.-]|$)/i.test(
      hostname
    );
  } catch {
    return false;
  }
}

function resolveClaudeHeaders(providerType: ProviderType, apiKey: string, providerUrl?: string) {
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };

  if (providerType === "claude-auth") {
    headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  if (looksLikeAnthropicProxy(providerUrl)) {
    headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  // 对非代理 Anthropic 直连保留双头，兼容只认 x-api-key 或 Bearer 的 Anthropic-compatible 层。
  headers["x-api-key"] = apiKey;
  headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

export function getTestBody(providerType: ProviderType, model?: string): Record<string, unknown> {
  const targetModel = model || DEFAULT_MODELS[providerType];

  switch (providerType) {
    case "claude":
    case "claude-auth":
      return { ...CLAUDE_TEST_BODY, model: targetModel };
    case "codex":
      return { ...CODEX_TEST_BODY, model: targetModel };
    case "openai-compatible":
      return { ...OPENAI_TEST_BODY, model: targetModel };
    case "gemini":
    case "gemini-cli":
      return { ...GEMINI_TEST_BODY };
    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }
}

export function getTestHeaders(
  providerType: ProviderType,
  apiKey: string,
  providerUrl?: string,
  overrides?: {
    userAgent?: string;
    extraHeaders?: Record<string, string>;
  }
): Record<string, string> {
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    "User-Agent": overrides?.userAgent || USER_AGENTS[providerType],
  };

  switch (providerType) {
    case "claude":
    case "claude-auth":
      Object.assign(
        headers,
        CLAUDE_TEST_HEADERS,
        resolveClaudeHeaders(providerType, apiKey, providerUrl)
      );
      break;
    case "codex":
      Object.assign(headers, {
        ...CODEX_TEST_HEADERS,
        Authorization: `Bearer ${apiKey}`,
      });
      break;
    case "openai-compatible":
      Object.assign(headers, {
        ...OPENAI_TEST_HEADERS,
        Authorization: `Bearer ${apiKey}`,
      });
      break;
    case "gemini":
    case "gemini-cli":
      Object.assign(headers, {
        ...GEMINI_TEST_HEADERS,
        "x-goog-api-key": apiKey,
      });
      break;
    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }

  return {
    ...headers,
    ...(overrides?.extraHeaders || {}),
  };
}

export function getTestUrl(
  baseUrl: string,
  providerType: ProviderType,
  model?: string,
  pathOverride?: string
): string {
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  const endpoint = pathOverride || API_ENDPOINTS[providerType];
  const targetModel = model || DEFAULT_MODELS[providerType];
  let url = `${cleanBaseUrl}${endpoint}`;

  if (providerType === "gemini" || providerType === "gemini-cli") {
    url = url.replace("{model}", targetModel);
  }

  return url;
}
