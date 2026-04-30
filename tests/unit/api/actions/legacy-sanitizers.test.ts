import { describe, expect, test } from "vitest";
import {
  hasLegacyRedactedWritePlaceholders,
  preserveLegacyProviderUpdateInput,
  preserveLegacyWebhookTargetUpdateInput,
  sanitizeLegacyNotificationBindingResponse,
  sanitizeLegacyNotificationSettingsResponse,
  sanitizeLegacyProviderResponse,
  sanitizeLegacyWebhookTargetResponse,
} from "@/lib/api/legacy-action-sanitizers";

describe("legacy action response sanitizers", () => {
  test("redacts provider secondary secrets kept in legacy list responses", () => {
    const sanitized = sanitizeLegacyProviderResponse({
      id: 1,
      apiKey: "sk-provider-secret-value",
      customHeaders: {
        Authorization: "Bearer upstream",
        "X-Api-Key": "upstream-key",
        "X-Trace": "trace-id",
      },
      providerUrl: "https://provider-user:provider-pass@provider.example.com/v1",
      mcpPassthroughUrl: "https://mcp-user:mcp-pass@mcp.example.com/bridge",
      proxyUrl: "https://user:pass@example.com/proxy",
      url: "https://main-user:main-pass@api.example.com/v1",
      websiteUrl: "https://web-user:web-pass@example.com",
    });

    expect(sanitized.apiKey).toBe("sk-p...[REDACTED]...alue");
    expect(sanitized.customHeaders).toEqual({
      Authorization: "[REDACTED]",
      "X-Api-Key": "[REDACTED]",
      "X-Trace": "trace-id",
    });
    expect(sanitized.providerUrl).toBe("https://REDACTED:REDACTED@provider.example.com/v1");
    expect(sanitized.mcpPassthroughUrl).toBe("https://REDACTED:REDACTED@mcp.example.com/bridge");
    expect(sanitized.proxyUrl).toBe("https://REDACTED:REDACTED@example.com/proxy");
    expect(sanitized.url).toBe("https://REDACTED:REDACTED@api.example.com/v1");
    expect(sanitized.websiteUrl).toBe("https://REDACTED:REDACTED@example.com/");
    expect(JSON.stringify(sanitized)).not.toContain("provider-pass");
    expect(JSON.stringify(sanitized)).not.toContain("main-pass");
    expect(JSON.stringify(sanitized)).not.toContain("web-pass");
  });

  test("redacts webhook target secrets kept in legacy list responses", () => {
    const sanitized = sanitizeLegacyWebhookTargetResponse({
      id: 1,
      customHeaders: {
        "X-Webhook-Secret": "shared-secret",
        "X-Source": "cch",
      },
      dingtalkSecret: "ding-secret-value",
      webhookUrl: "https://token:secret@example.com/webhook",
      proxyUrl: "socks5://user:pass@example.com:1080",
      telegramBotToken: "telegram-secret-token",
    });

    expect(sanitized.customHeaders).toEqual({
      "X-Webhook-Secret": "[REDACTED]",
      "X-Source": "cch",
    });
    expect(sanitized.dingtalkSecret).toBe("ding...[REDACTED]...alue");
    expect(sanitized.webhookUrl).toBe("[REDACTED]");
    expect(sanitized.proxyUrl).toBe("socks5://REDACTED:REDACTED@example.com:1080");
    expect(sanitized.telegramBotToken).toBe("tele...[REDACTED]...oken");
  });

  test("redacts nested notification binding targets in legacy responses", () => {
    const sanitized = sanitizeLegacyNotificationBindingResponse({
      id: 1,
      target: {
        webhookUrl: "https://token:secret@example.com/webhook",
        customHeaders: { Authorization: "Bearer downstream-secret" },
        proxyUrl: "https://proxy-user:proxy-pass@proxy.example.com",
        telegramBotToken: "telegram-secret-token",
        dingtalkSecret: "dingtalk-secret-value",
      },
    });

    expect(sanitized.target).toMatchObject({
      webhookUrl: "[REDACTED]",
      customHeaders: { Authorization: "[REDACTED]" },
      proxyUrl: "https://REDACTED:REDACTED@proxy.example.com/",
      telegramBotToken: "tele...[REDACTED]...oken",
      dingtalkSecret: "ding...[REDACTED]...alue",
    });
    expect(JSON.stringify(sanitized)).not.toContain("downstream-secret");
    expect(JSON.stringify(sanitized)).not.toContain("proxy-pass");
  });

  test("redacts legacy notification settings webhook URLs", () => {
    const sanitized = sanitizeLegacyNotificationSettingsResponse({
      id: 1,
      circuitBreakerWebhook: "https://circuit.example.com/hook?token=circuit-secret",
      dailyLeaderboardWebhook: "https://leaderboard.example.com/hook?token=leaderboard-secret",
      costAlertWebhook: "https://cost.example.com/hook?token=cost-secret",
      cacheHitRateAlertWebhook: null,
    });

    expect(sanitized).toMatchObject({
      circuitBreakerWebhook: "[REDACTED]",
      dailyLeaderboardWebhook: "[REDACTED]",
      costAlertWebhook: "[REDACTED]",
      cacheHitRateAlertWebhook: null,
    });
    expect(JSON.stringify(sanitized)).not.toContain("circuit-secret");
    expect(JSON.stringify(sanitized)).not.toContain("leaderboard-secret");
    expect(JSON.stringify(sanitized)).not.toContain("cost-secret");
  });

  test("preserves legacy provider secrets when redacted values are echoed on update", () => {
    const preserved = preserveLegacyProviderUpdateInput(
      {
        name: "Renamed",
        url: "https://REDACTED:REDACTED@api.example.com/v1",
        proxy_url: "https://REDACTED:REDACTED@proxy.example.com/",
        website_url: "https://REDACTED:REDACTED@example.com/",
        mcp_passthrough_url: "https://REDACTED:REDACTED@mcp.example.com/bridge",
        key: "sk-a...[REDACTED]...xxxx",
        custom_headers: {
          authorization: "[REDACTED]",
          "X-Trace": "changed",
        },
      },
      {
        url: "https://main-user:main-pass@api.example.com/v1",
        proxyUrl: "https://proxy-user:proxy-pass@proxy.example.com",
        websiteUrl: "https://web-user:web-pass@example.com",
        mcpPassthroughUrl: "https://mcp-user:mcp-pass@mcp.example.com/bridge",
        customHeaders: {
          Authorization: "Bearer upstream-secret",
          "X-Trace": "trace-id",
        },
      }
    );

    expect(preserved).toEqual({
      name: "Renamed",
      custom_headers: {
        authorization: "Bearer upstream-secret",
        "X-Trace": "changed",
      },
    });
  });

  test("preserves legacy webhook target secrets when redacted values are echoed on update", () => {
    const preserved = preserveLegacyWebhookTargetUpdateInput(
      {
        name: "Ops 2",
        providerType: "telegram",
        webhookUrl: "[REDACTED]",
        telegramBotToken: "tele...[REDACTED]...oken",
        customHeaders: {
          authorization: "[REDACTED]",
          "X-Trace": "changed",
        },
        proxyUrl: "https://REDACTED:REDACTED@proxy.example.com/",
      },
      {
        providerType: "telegram",
        webhookUrl: "https://token:secret@example.com/webhook",
        telegramBotToken: "telegram-secret-token",
        customHeaders: {
          Authorization: "Bearer webhook-secret",
          "X-Trace": "trace-id",
        },
        proxyUrl: "https://proxy-user:proxy-pass@proxy.example.com",
      }
    );

    expect(preserved).toEqual({
      name: "Ops 2",
      providerType: "telegram",
      customHeaders: {
        authorization: "Bearer webhook-secret",
        "X-Trace": "changed",
      },
    });
  });

  test("detects redacted placeholders in legacy create payloads", () => {
    expect(
      hasLegacyRedactedWritePlaceholders({ url: "https://REDACTED:REDACTED@example.com" })
    ).toBe(true);
    expect(
      hasLegacyRedactedWritePlaceholders({ customHeaders: { Authorization: "[REDACTED]" } })
    ).toBe(true);
    expect(hasLegacyRedactedWritePlaceholders({ url: "https://api.example.com" })).toBe(false);
  });
});
