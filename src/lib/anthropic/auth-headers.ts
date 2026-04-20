import type { ProviderType } from "@/types/provider";

function getHostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isOfficialAnthropicHost(hostname: string | null): boolean {
  return hostname ? hostname.endsWith("anthropic.com") || hostname.endsWith("claude.ai") : false;
}

function looksLikeAnthropicRelayHost(hostname: string | null): boolean {
  return hostname
    ? /proxy|relay|gateway|router|openai|api2d|openrouter|worker|gpt|codex/i.test(hostname)
    : false;
}

export function resolveAnthropicAuthHeaders(input: {
  apiKey: string;
  providerUrl: string;
  providerType?: ProviderType;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };

  if (input.providerType === "claude-auth") {
    headers.authorization = `Bearer ${input.apiKey}`;
    return headers;
  }

  const hostname = getHostnameFromUrl(input.providerUrl);

  if (isOfficialAnthropicHost(hostname)) {
    headers["x-api-key"] = input.apiKey;
    return headers;
  }

  if (looksLikeAnthropicRelayHost(hostname)) {
    headers.authorization = `Bearer ${input.apiKey}`;
    return headers;
  }

  headers.authorization = `Bearer ${input.apiKey}`;
  headers["x-api-key"] = input.apiKey;
  return headers;
}
