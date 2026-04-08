/**
 * Preset Configuration Management
 *
 * 请求体主要参考 relay-pulse 的 templates 目录，OpenAI Compatible 套件则补充
 * 官方 Chat Completions 兼容模板，避免继续复用 Codex Responses 模板。
 */

import type { ProviderType } from "@/types/provider";
import ccBetaCli from "./data/cc_beta_cli.json";
import ccHaikuBasic from "./data/cc_haiku_basic.json";
import cxCodexBasic from "./data/cx_codex_basic.json";
import cxGptBasic from "./data/cx_gpt_basic.json";
import gmFlashBasic from "./data/gm_flash_basic.json";
import gmProBasic from "./data/gm_pro_basic.json";
import oaChatBasic from "./data/oa_chat_basic.json";
import oaChatStream from "./data/oa_chat_stream.json";
import publicCcBase from "./data/public_cc_base.json";

export interface PresetConfig {
  id: string;
  description: string;
  providerTypes: ProviderType[];
  payload: Record<string, unknown>;
  defaultSuccessContains: string;
  defaultModel: string;
  path: string;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
  score?: number;
  modelHints?: string[];
  urlHints?: string[];
}

export interface PresetSelectionContext {
  providerType: ProviderType;
  providerUrl?: string;
  model?: string;
}

export const PRESETS: Record<string, PresetConfig> = {
  cc_haiku_basic: {
    id: "cc_haiku_basic",
    description: "Claude CLI haiku stream",
    providerTypes: ["claude", "claude-auth"],
    payload: ccHaikuBasic,
    defaultSuccessContains: "pong",
    defaultModel: "claude-haiku-4-5-20251001",
    path: "/v1/messages",
    userAgent: "claude-cli/2.1.84 (external, cli)",
    extraHeaders: {
      "Anthropic-Beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14",
      "Anthropic-Dangerous-Direct-Browser-Access": "true",
      "X-App": "cli",
    },
    score: 100,
    modelHints: ["haiku"],
  },
  cc_beta_cli: {
    id: "cc_beta_cli",
    description: "Claude CLI beta relay profile",
    providerTypes: ["claude", "claude-auth"],
    payload: ccBetaCli,
    defaultSuccessContains: "pong",
    defaultModel: "claude-haiku-4-5-20251001",
    path: "/v1/messages?beta=true",
    userAgent: "claude-cli/2.1.84 (external, cli)",
    extraHeaders: {
      "Anthropic-Beta":
        "oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05",
      "Anthropic-Dangerous-Direct-Browser-Access": "true",
      "X-App": "cli",
    },
    score: 90,
    urlHints: ["beta=true", "gateway", "relay", "router", "worker", "proxy"],
  },
  cc_public_thinking: {
    id: "cc_public_thinking",
    description: "Public Claude with thinking enabled",
    providerTypes: ["claude", "claude-auth"],
    payload: publicCcBase,
    defaultSuccessContains: "pong",
    defaultModel: "claude-sonnet-4-5-20250929",
    path: "/v1/messages",
    userAgent: "claude-cli/2.1.76 (external, cli)",
    extraHeaders: {
      "Anthropic-Beta": "interleaved-thinking-2025-05-14,context-management-2025-06-27",
      "Anthropic-Dangerous-Direct-Browser-Access": "true",
      "X-App": "cli",
    },
    score: 80,
    modelHints: ["sonnet", "opus"],
  },
  cx_codex_basic: {
    id: "cx_codex_basic",
    description: "Codex Responses stream",
    providerTypes: ["codex"],
    payload: cxCodexBasic,
    defaultSuccessContains: "pong",
    defaultModel: "gpt-5.3-codex",
    path: "/v1/responses",
    userAgent: "Codex-CLI/1.0",
    extraHeaders: {
      "openai-beta": "responses=experimental",
    },
    score: 100,
    modelHints: ["codex"],
  },
  cx_gpt_basic: {
    id: "cx_gpt_basic",
    description: "Responses API GPT profile",
    providerTypes: ["codex"],
    payload: cxGptBasic,
    defaultSuccessContains: "pong",
    defaultModel: "gpt-5.4",
    path: "/v1/responses",
    userAgent: "Codex-CLI/1.0",
    extraHeaders: {
      "openai-beta": "responses=experimental",
    },
    score: 85,
    modelHints: ["gpt-", "o1", "o3", "o4"],
  },
  oa_chat_basic: {
    id: "oa_chat_basic",
    description: "OpenAI compatible chat completion",
    providerTypes: ["openai-compatible"],
    payload: oaChatBasic,
    defaultSuccessContains: "pong",
    defaultModel: "gpt-4.1-mini",
    path: "/v1/chat/completions",
    userAgent: "OpenAI-Compatible/2026.04",
    score: 100,
  },
  oa_chat_stream: {
    id: "oa_chat_stream",
    description: "OpenAI compatible chat completion stream",
    providerTypes: ["openai-compatible"],
    payload: oaChatStream,
    defaultSuccessContains: "pong",
    defaultModel: "gpt-4.1-mini",
    path: "/v1/chat/completions",
    userAgent: "OpenAI-Compatible/2026.04",
    extraHeaders: {
      Accept: "application/json, text/event-stream",
    },
    score: 85,
  },
  gm_flash_basic: {
    id: "gm_flash_basic",
    description: "Gemini generateContent flash",
    providerTypes: ["gemini", "gemini-cli"],
    payload: gmFlashBasic,
    defaultSuccessContains: "pong",
    defaultModel: "gemini-2.5-flash",
    path: "/v1beta/models/{model}:generateContent",
    userAgent: "GeminiCLI/v24.11.0 (linux; x64)",
    extraHeaders: {
      "x-goog-api-client": "google-genai-sdk/1.30.0 gl-node/v24.11.0",
    },
    score: 100,
    modelHints: ["flash"],
  },
  gm_pro_basic: {
    id: "gm_pro_basic",
    description: "Gemini generateContent pro",
    providerTypes: ["gemini", "gemini-cli"],
    payload: gmProBasic,
    defaultSuccessContains: "pong",
    defaultModel: "gemini-2.5-pro",
    path: "/v1beta/models/{model}:generateContent",
    userAgent: "GeminiCLI/v24.11.0 (linux; x64)",
    extraHeaders: {
      "x-goog-api-client": "google-genai-sdk/1.30.0 gl-node/v24.11.0",
    },
    score: 90,
    modelHints: ["pro", "thinking"],
  },
};

export const PRESET_MAPPING: Record<ProviderType, string[]> = {
  claude: ["cc_haiku_basic", "cc_beta_cli", "cc_public_thinking"],
  "claude-auth": ["cc_haiku_basic", "cc_beta_cli", "cc_public_thinking"],
  codex: ["cx_codex_basic", "cx_gpt_basic"],
  "openai-compatible": ["oa_chat_basic", "oa_chat_stream"],
  gemini: ["gm_flash_basic", "gm_pro_basic"],
  "gemini-cli": ["gm_flash_basic", "gm_pro_basic"],
};

export function getPresetsForProvider(providerType: ProviderType): PresetConfig[] {
  const presetIds = PRESET_MAPPING[providerType] || [];
  return presetIds.map((id) => PRESETS[id]).filter(Boolean);
}

export function getPreset(presetId: string): PresetConfig | undefined {
  return PRESETS[presetId];
}

export function getPresetPayload(presetId: string, model?: string): Record<string, unknown> {
  const preset = PRESETS[presetId];
  if (!preset) {
    throw new Error(`Preset not found: ${presetId}`);
  }

  const payload = JSON.parse(JSON.stringify(preset.payload)) as Record<string, unknown>;
  if (model && "model" in payload) {
    payload.model = model;
  }

  return payload;
}

export function isPresetCompatible(presetId: string, providerType: ProviderType): boolean {
  const presetIds = PRESET_MAPPING[providerType] || [];
  return presetIds.includes(presetId);
}

export function getDefaultPreset(providerType: ProviderType): PresetConfig | undefined {
  const presets = getPresetsForProvider(providerType);
  return presets[0];
}

function scorePreset(preset: PresetConfig, context: PresetSelectionContext): number {
  let score = preset.score ?? 0;
  const model = context.model?.toLowerCase() ?? "";
  const url = context.providerUrl?.toLowerCase() ?? "";

  if (preset.modelHints?.some((hint) => model.includes(hint))) {
    score += 50;
  }

  if (preset.urlHints?.some((hint) => url.includes(hint))) {
    score += 30;
  }

  if (!model) {
    return score;
  }

  // 让 Codex / Gemini 能根据模型名优先选更贴近的模板。
  if (context.providerType === "codex") {
    if (model.includes("codex") && preset.id === "cx_codex_basic") {
      score += 40;
    }
    if (!model.includes("codex") && preset.id === "cx_gpt_basic") {
      score += 40;
    }
  }

  if (context.providerType === "gemini" || context.providerType === "gemini-cli") {
    if (model.includes("flash") && preset.id === "gm_flash_basic") {
      score += 40;
    }
    if ((model.includes("pro") || model.includes("thinking")) && preset.id === "gm_pro_basic") {
      score += 40;
    }
  }

  return score;
}

export function getExecutionPresetCandidates(context: PresetSelectionContext): PresetConfig[] {
  return getPresetsForProvider(context.providerType).sort(
    (left, right) => scorePreset(right, context) - scorePreset(left, context)
  );
}
