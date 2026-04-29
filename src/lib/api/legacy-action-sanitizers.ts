import {
  redactHeaderRecord,
  redactSecret,
  redactUrlCredentials,
} from "@/lib/api/v1/_shared/redaction";

type LegacySecretBearingRecord = {
  apiKey?: string | null;
  customHeaders?: Record<string, string> | null;
  dingtalkSecret?: string | null;
  mcpPassthroughUrl?: string | null;
  providerUrl?: string | null;
  proxyUrl?: string | null;
  telegramBotToken?: string | null;
  url?: string | null;
  webhookUrl?: string | null;
  websiteUrl?: string | null;
};

type LegacyNotificationSettingsRecord = {
  cacheHitRateAlertWebhook?: string | null;
  circuitBreakerWebhook?: string | null;
  costAlertWebhook?: string | null;
  dailyLeaderboardWebhook?: string | null;
};

function redactWebhookField(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value ? "[REDACTED]" : value;
}

export function sanitizeLegacyNotificationSettingsResponse<
  T extends LegacyNotificationSettingsRecord,
>(settings: T): T {
  return {
    ...settings,
    cacheHitRateAlertWebhook: redactWebhookField(settings.cacheHitRateAlertWebhook),
    circuitBreakerWebhook: redactWebhookField(settings.circuitBreakerWebhook),
    costAlertWebhook: redactWebhookField(settings.costAlertWebhook),
    dailyLeaderboardWebhook: redactWebhookField(settings.dailyLeaderboardWebhook),
  } as T;
}

export function sanitizeLegacyProviderResponse<T extends LegacySecretBearingRecord>(
  provider: T
): T {
  return {
    ...provider,
    apiKey: provider.apiKey === undefined ? provider.apiKey : redactSecret(provider.apiKey),
    customHeaders:
      provider.customHeaders === undefined
        ? provider.customHeaders
        : redactHeaderRecord(provider.customHeaders),
    providerUrl:
      provider.providerUrl === undefined
        ? provider.providerUrl
        : redactUrlCredentials(provider.providerUrl),
    mcpPassthroughUrl:
      provider.mcpPassthroughUrl === undefined
        ? provider.mcpPassthroughUrl
        : redactUrlCredentials(provider.mcpPassthroughUrl),
    proxyUrl:
      provider.proxyUrl === undefined ? provider.proxyUrl : redactUrlCredentials(provider.proxyUrl),
    url: provider.url === undefined ? provider.url : redactUrlCredentials(provider.url),
    websiteUrl:
      provider.websiteUrl === undefined
        ? provider.websiteUrl
        : redactUrlCredentials(provider.websiteUrl),
  };
}

export function sanitizeLegacyWebhookTargetResponse<T extends LegacySecretBearingRecord>(
  target: T
): T {
  return {
    ...target,
    customHeaders:
      target.customHeaders === undefined
        ? target.customHeaders
        : redactHeaderRecord(target.customHeaders),
    dingtalkSecret:
      target.dingtalkSecret === undefined
        ? target.dingtalkSecret
        : redactSecret(target.dingtalkSecret),
    webhookUrl:
      target.webhookUrl === undefined
        ? target.webhookUrl
        : target.webhookUrl
          ? "[REDACTED]"
          : target.webhookUrl,
    proxyUrl:
      target.proxyUrl === undefined ? target.proxyUrl : redactUrlCredentials(target.proxyUrl),
    telegramBotToken:
      target.telegramBotToken === undefined
        ? target.telegramBotToken
        : redactSecret(target.telegramBotToken),
  };
}

export function sanitizeLegacyNotificationBindingResponse<
  T extends { target?: LegacySecretBearingRecord | null },
>(binding: T): T {
  return {
    ...binding,
    target: binding.target ? sanitizeLegacyWebhookTargetResponse(binding.target) : binding.target,
  };
}

export function preserveLegacyProviderUpdateInput<
  T extends Record<string, unknown>,
  P extends LegacySecretBearingRecord,
>(input: T, existing: P): T {
  const next: Record<string, unknown> = { ...input };
  const urlFields = [
    ["url", "url"],
    ["proxy_url", "proxyUrl"],
    ["website_url", "websiteUrl"],
    ["mcp_passthrough_url", "mcpPassthroughUrl"],
  ] as const;

  for (const [inputKey, existingKey] of urlFields) {
    if (isRedactedUrlEcho(next[inputKey], existing[existingKey])) {
      delete next[inputKey];
    }
  }

  const customHeaders = next["custom_headers"] ?? next["customHeaders"];
  if (isHeaderRecord(customHeaders) && existing.customHeaders) {
    const restored = restoreRedactedHeaderValues(customHeaders, existing.customHeaders);
    if (next["custom_headers"] !== undefined) next["custom_headers"] = restored;
    if (next["customHeaders"] !== undefined) next["customHeaders"] = restored;
  }

  return next as T;
}

export function preserveLegacyWebhookTargetUpdateInput<
  T extends Record<string, unknown>,
  W extends LegacySecretBearingRecord & {
    providerType?: string | null;
    telegramChatId?: string | null;
  },
>(input: T, existing: W): T {
  const next: Record<string, unknown> = { ...input };
  const providerType = String(next.providerType ?? existing.providerType ?? "");

  if (next.webhookUrl === "[REDACTED]" && existing.webhookUrl) {
    delete next.webhookUrl;
  }

  if (isRedactedUrlEcho(next.proxyUrl, existing.proxyUrl)) {
    delete next.proxyUrl;
  }

  if (
    providerType === "telegram" &&
    isRedactedSecretEcho(next.telegramBotToken, existing.telegramBotToken)
  ) {
    delete next.telegramBotToken;
  }

  if (
    providerType === "dingtalk" &&
    isRedactedSecretEcho(next.dingtalkSecret, existing.dingtalkSecret)
  ) {
    delete next.dingtalkSecret;
  }

  if (isHeaderRecord(next.customHeaders) && existing.customHeaders) {
    next.customHeaders = restoreRedactedHeaderValues(next.customHeaders, existing.customHeaders);
  }

  return next as T;
}

export function hasLegacyRedactedWritePlaceholders(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes("[REDACTED]") || value.includes("REDACTED:REDACTED@");
  }
  if (Array.isArray(value)) return value.some(hasLegacyRedactedWritePlaceholders);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(hasLegacyRedactedWritePlaceholders);
}

function isRedactedSecretEcho(value: unknown, existing: string | null | undefined): boolean {
  if (!existing) return false;
  return value === null || value === "" || value === redactSecret(existing);
}

function isRedactedUrlEcho(value: unknown, existing: string | null | undefined): boolean {
  if (typeof value !== "string" || !existing) return false;
  const redactedExisting = redactUrlCredentials(existing);
  return redactedExisting !== existing && redactedExisting === value;
}

function isHeaderRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function restoreRedactedHeaderValues(
  incoming: Record<string, string>,
  existing: Record<string, string>
): Record<string, string> {
  const redactedExisting = redactHeaderRecord(existing) ?? {};
  const existingByLowerName = new Map(
    Object.entries(existing).map(([name, value]) => [name.toLowerCase(), value])
  );
  const redactedExistingByLowerName = new Map(
    Object.entries(redactedExisting).map(([name, value]) => [name.toLowerCase(), value])
  );

  return Object.fromEntries(
    Object.entries(incoming).map(([name, value]) => [
      name,
      value === "[REDACTED]" &&
      (redactedExisting[name] === "[REDACTED]" ||
        redactedExistingByLowerName.get(name.toLowerCase()) === "[REDACTED]")
        ? (existing[name] ?? existingByLowerName.get(name.toLowerCase()) ?? value)
        : value,
    ])
  );
}
