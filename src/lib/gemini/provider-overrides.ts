import type { GeminiGoogleSearchOverrideSpecialSetting } from "@/types/special-settings";

type GeminiProviderOverrideConfig = {
  id?: number;
  name?: string;
  providerType?: string;
  geminiGoogleSearchPreference?: string | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check if a tools array contains a googleSearch tool
 */
function hasGoogleSearchTool(tools: unknown[]): boolean {
  return tools.some((tool) => {
    if (!isPlainObject(tool)) return false;
    return "googleSearch" in tool;
  });
}

/**
 * Remove googleSearch tools from a tools array
 */
function removeGoogleSearchTools(tools: unknown[]): unknown[] {
  return tools.filter((tool) => {
    if (!isPlainObject(tool)) return true;
    return !("googleSearch" in tool);
  });
}

/**
 * Apply Gemini Google Search provider override to request body.
 *
 * Conventions:
 * - providerType !== "gemini" && providerType !== "gemini-cli" -> no processing
 * - Preference value null/undefined/"inherit" means "follow client"
 * - Overrides affect:
 *   - tools array (inject or remove googleSearch tool)
 */
export function applyGeminiGoogleSearchOverride(
  provider: GeminiProviderOverrideConfig,
  request: Record<string, unknown>
): Record<string, unknown> {
  if (provider.providerType !== "gemini" && provider.providerType !== "gemini-cli") {
    return request;
  }

  const preference = provider.geminiGoogleSearchPreference;

  // inherit or not set -> pass through unchanged
  if (!preference || preference === "inherit") {
    return request;
  }

  let output: Record<string, unknown> = request;
  const ensureCloned = () => {
    if (output === request) {
      output = { ...request };
    }
  };

  const existingTools = Array.isArray(request.tools) ? request.tools : [];
  const hadGoogleSearch = hasGoogleSearchTool(existingTools);

  if (preference === "enabled") {
    // Force inject googleSearch tool if not present
    if (!hadGoogleSearch) {
      ensureCloned();
      output.tools = [...existingTools, { googleSearch: {} }];
    }
  } else if (preference === "disabled") {
    // Force remove googleSearch tool if present
    if (hadGoogleSearch) {
      ensureCloned();
      const filteredTools = removeGoogleSearchTools(existingTools);
      if (filteredTools.length > 0) {
        output.tools = filteredTools;
      } else {
        // Remove tools array entirely if empty after filtering
        delete output.tools;
      }
    }
  }

  return output;
}

/**
 * Apply Gemini Google Search override with audit trail
 */
export function applyGeminiGoogleSearchOverrideWithAudit(
  provider: GeminiProviderOverrideConfig,
  request: Record<string, unknown>
): { request: Record<string, unknown>; audit: GeminiGoogleSearchOverrideSpecialSetting | null } {
  if (provider.providerType !== "gemini" && provider.providerType !== "gemini-cli") {
    return { request, audit: null };
  }

  const preference = provider.geminiGoogleSearchPreference;

  // inherit or not set -> pass through unchanged, no audit
  if (!preference || preference === "inherit") {
    return { request, audit: null };
  }

  const existingTools = Array.isArray(request.tools) ? request.tools : [];
  const hadGoogleSearch = hasGoogleSearchTool(existingTools);

  // Determine action based on preference and current state
  let action: "inject" | "remove" | "passthrough";
  if (preference === "enabled") {
    action = hadGoogleSearch ? "passthrough" : "inject";
  } else {
    // disabled
    action = hadGoogleSearch ? "remove" : "passthrough";
  }

  const nextRequest = applyGeminiGoogleSearchOverride(provider, request);

  const audit: GeminiGoogleSearchOverrideSpecialSetting = {
    type: "gemini_google_search_override",
    scope: "request",
    hit: true,
    providerId: provider.id ?? null,
    providerName: provider.name ?? null,
    action,
    preference: preference as "enabled" | "disabled",
    hadGoogleSearchInRequest: hadGoogleSearch,
  };

  return { request: nextRequest, audit };
}
