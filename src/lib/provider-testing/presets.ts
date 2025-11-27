/**
 * Preset Configuration Management
 *
 * Manages pre-configured test payloads from relay-pulse project.
 * These presets provide authentic CLI request patterns that pass
 * relay service client verification.
 */

import type { ProviderType } from "@/types/provider";

// Import preset JSON files
import ccBase from "./data/cc_base.json";
import ccSonnet from "./data/cc_sonnet.json";
import cxBase from "./data/cx_base.json";
import publicCcBase from "./data/public_cc_base.json";

// ============================================================================
// Types
// ============================================================================

export interface PresetConfig {
  /** Unique identifier for the preset */
  id: string;
  /** Human-readable description */
  description: string;
  /** Provider types this preset is compatible with */
  providerTypes: ProviderType[];
  /** The request payload template */
  payload: Record<string, unknown>;
  /** Default success detection keyword */
  defaultSuccessContains: string;
  /** Default model used in this preset */
  defaultModel: string;
}

// ============================================================================
// Preset Definitions
// ============================================================================

/**
 * All available preset configurations
 */
export const PRESETS: Record<string, PresetConfig> = {
  cc_base: {
    id: "cc_base",
    description: "Claude CLI base (haiku, fast)",
    providerTypes: ["claude", "claude-auth"],
    payload: ccBase,
    defaultSuccessContains: "isNewTopic",
    defaultModel: "claude-haiku-4-5-20251001",
  },
  cc_sonnet: {
    id: "cc_sonnet",
    description: "Claude CLI sonnet (with cache)",
    providerTypes: ["claude", "claude-auth"],
    payload: ccSonnet,
    defaultSuccessContains: "pong",
    defaultModel: "claude-sonnet-4-5-20250929",
  },
  public_cc_base: {
    id: "public_cc_base",
    description: "Public/Community Claude (thinking enabled)",
    providerTypes: ["claude", "claude-auth"],
    payload: publicCcBase,
    defaultSuccessContains: "pong",
    defaultModel: "claude-sonnet-4-5-20250929",
  },
  cx_base: {
    id: "cx_base",
    description: "Codex CLI (Response API)",
    providerTypes: ["codex", "openai-compatible"],
    payload: cxBase,
    defaultSuccessContains: "pong",
    defaultModel: "gpt-5-codex",
  },
};

/**
 * Mapping of provider types to available presets
 */
export const PRESET_MAPPING: Record<ProviderType, string[]> = {
  claude: ["cc_base", "cc_sonnet", "public_cc_base"],
  "claude-auth": ["cc_base", "cc_sonnet", "public_cc_base"],
  codex: ["cx_base"],
  "openai-compatible": ["cx_base"],
  gemini: [], // Gemini uses its own format
  "gemini-cli": [],
};

// ============================================================================
// Functions
// ============================================================================

/**
 * Get available presets for a provider type
 */
export function getPresetsForProvider(providerType: ProviderType): PresetConfig[] {
  const presetIds = PRESET_MAPPING[providerType] || [];
  return presetIds.map((id) => PRESETS[id]).filter(Boolean);
}

/**
 * Get a specific preset by ID
 */
export function getPreset(presetId: string): PresetConfig | undefined {
  return PRESETS[presetId];
}

/**
 * Get preset payload with optional model override
 *
 * @param presetId - The preset identifier
 * @param model - Optional model to override the default
 * @returns The payload object with model applied
 */
export function getPresetPayload(presetId: string, model?: string): Record<string, unknown> {
  const preset = PRESETS[presetId];
  if (!preset) {
    throw new Error(`Preset not found: ${presetId}`);
  }

  // Deep clone to avoid mutating the original
  const payload = JSON.parse(JSON.stringify(preset.payload)) as Record<string, unknown>;

  // Override model if provided
  if (model) {
    payload.model = model;
  }

  return payload;
}

/**
 * Check if a preset is compatible with a provider type
 */
export function isPresetCompatible(presetId: string, providerType: ProviderType): boolean {
  const presetIds = PRESET_MAPPING[providerType] || [];
  return presetIds.includes(presetId);
}

/**
 * Get default preset for a provider type
 * Returns the first available preset or undefined
 */
export function getDefaultPreset(providerType: ProviderType): PresetConfig | undefined {
  const presets = getPresetsForProvider(providerType);
  return presets[0];
}
