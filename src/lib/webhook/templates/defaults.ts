import type { WebhookNotificationType } from "../types";

export const DEFAULT_TEMPLATES = {
  custom_generic: {
    title: "{{title}}",
    level: "{{level}}",
    timestamp: "{{timestamp}}",
    content: "{{sections}}",
  },

  circuit_breaker: {
    title: "{{title}}",
    provider: "{{provider_name}}",
    providerId: "{{provider_id}}",
    failureCount: "{{failure_count}}",
    retryAt: "{{retry_at}}",
    error: "{{last_error}}",
  },

  daily_leaderboard: {
    title: "{{title}}",
    date: "{{date}}",
    totalRequests: "{{total_requests}}",
    totalCost: "{{total_cost}}",
    entries: "{{entries_json}}",
  },

  cost_alert: {
    title: "{{title}}",
    targetType: "{{target_type}}",
    targetName: "{{target_name}}",
    currentCost: "{{current_cost}}",
    quotaLimit: "{{quota_limit}}",
    usagePercent: "{{usage_percent}}",
  },

  cache_hit_rate_alert: {
    title: "{{title}}",
    windowMode: "{{window_mode}}",
    windowStart: "{{window_start}}",
    windowEnd: "{{window_end}}",
    anomalyCount: "{{anomaly_count}}",
    suppressedCount: "{{suppressed_count}}",
    anomalies: "{{anomalies_json}}",
    absMin: "{{abs_min}}",
    dropRel: "{{drop_rel}}",
    dropAbs: "{{drop_abs}}",
    cooldownMinutes: "{{cooldown_minutes}}",
    topN: "{{top_n}}",
    generatedAt: "{{generated_at}}",
  },
} as const;

export const DEFAULT_TEMPLATE_BY_NOTIFICATION_TYPE: Record<
  WebhookNotificationType,
  Record<string, unknown>
> = {
  circuit_breaker: DEFAULT_TEMPLATES.circuit_breaker,
  daily_leaderboard: DEFAULT_TEMPLATES.daily_leaderboard,
  cost_alert: DEFAULT_TEMPLATES.cost_alert,
  cache_hit_rate_alert: DEFAULT_TEMPLATES.cache_hit_rate_alert,
};
