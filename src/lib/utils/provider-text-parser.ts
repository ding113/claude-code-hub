import type { ProviderType } from "@/types/provider";
import { isValidUrl } from "./validation";

export interface ParsedProviderInfo {
  name: string | null;
  url: string | null;
  key: string | null;
  providerType: ProviderType;
  confidence: {
    name: boolean;
    url: boolean;
    key: boolean;
    type: boolean;
  };
}

type DetectableProviderType = "claude" | "codex" | "gemini" | "openai-compatible";

const PROVIDER_TYPE_KEYWORDS: Record<DetectableProviderType, RegExp[]> = {
  claude: [/claude/i, /anthropic/i, /\/messages\b/i],
  codex: [/openai/i, /codex/i, /\bgpt\b/i, /\/responses\b/i],
  gemini: [/gemini/i, /vertex/i, /google/i, /v1beta/i],
  "openai-compatible": [/\/completions\b/i, /openai[\s-]*compatible/i],
};

const DETECTION_PRIORITY: DetectableProviderType[] = [
  "openai-compatible",
  "claude",
  "codex",
  "gemini",
];

export function generateRandomSuffix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function detectProviderType(text: string): ProviderType {
  for (const type of DETECTION_PRIORITY) {
    const keywords = PROVIDER_TYPE_KEYWORDS[type];
    if (keywords.some((regex) => regex.test(text))) {
      return type;
    }
  }
  return "claude";
}

export function extractUrl(text: string): string | null {
  const urlPattern = /https?:\/\/[^\s"'<>\])+,]+/gi;
  const matches = text.match(urlPattern);
  if (!matches) return null;

  const cleanUrl = (url: string): string => {
    return url.replace(/[.,;:!?)]+$/, "");
  };

  const apiIndicators = /api|v1|messages|responses|completions|chat|models/i;
  for (const match of matches) {
    const cleaned = cleanUrl(match);
    if (isValidUrl(cleaned) && apiIndicators.test(cleaned)) {
      return cleaned;
    }
  }

  for (const match of matches) {
    const cleaned = cleanUrl(match);
    if (isValidUrl(cleaned)) {
      return cleaned;
    }
  }

  return null;
}

export function extractApiKey(text: string): string | null {
  const patterns = [
    /sk-ant-[a-zA-Z0-9_-]{20,}/,
    /sk-[a-zA-Z0-9_-]{20,}/,
    /AIza[a-zA-Z0-9_-]{30,}/,
    /\b[a-zA-Z0-9_-]{32,128}\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

export function extractProviderName(text: string): string | null {
  const namePatterns = [
    /(?:name|provider|service)[\s]*[:\s=]+[\s]*["']?([^"'\n,;]+)["']?/i,
    /^([A-Za-z][A-Za-z0-9_-]{2,})/m,
  ];

  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) {
      const name = match[1].trim();
      if (name.length > 2 && name.length <= 60) {
        if (!/^https?:\/\//i.test(name) && !/^sk-/i.test(name) && !/^https?$/i.test(name)) {
          return name;
        }
      }
    }
  }
  return null;
}

export function isValidApiKeyFormat(key: string): boolean {
  if (!key || key.length < 20) return false;
  return /^[a-zA-Z0-9_-]+$/.test(key);
}

export function parseProviderText(text: string): ParsedProviderInfo {
  const url = extractUrl(text);
  const key = extractApiKey(text);
  const name = extractProviderName(text);
  const providerType = detectProviderType(text);

  return {
    name,
    url,
    key,
    providerType,
    confidence: {
      name: !!name,
      url: !!url && isValidUrl(url),
      key: !!key && isValidApiKeyFormat(key),
      type: providerType !== "claude",
    },
  };
}
