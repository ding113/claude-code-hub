export const v1Keys = {
  all: ["v1"] as const,
  users: {
    all: ["v1", "users"] as const,
    list: (params?: Record<string, unknown>) => ["v1", "users", "list", params ?? {}] as const,
    detail: (id: number) => ["v1", "users", "detail", id] as const,
  },
  providers: {
    all: ["v1", "providers"] as const,
    list: (params?: Record<string, unknown>) => ["v1", "providers", "list", params ?? {}] as const,
    detail: (id: number) => ["v1", "providers", "detail", id] as const,
    keyReveal: (id: number) => ["v1", "providers", "keyReveal", id] as const,
  },
  providerGroups: {
    all: ["v1", "provider-groups"] as const,
    list: () => ["v1", "provider-groups", "list"] as const,
    detail: (id: number) => ["v1", "provider-groups", "detail", id] as const,
  },
  webhookTargets: {
    all: ["v1", "webhook-targets"] as const,
    list: () => ["v1", "webhook-targets", "list"] as const,
    detail: (id: number) => ["v1", "webhook-targets", "detail", id] as const,
  },
  notifications: {
    all: ["v1", "notifications"] as const,
    settings: () => ["v1", "notifications", "settings"] as const,
    bindings: (type: string) => ["v1", "notifications", "bindings", type] as const,
  },
  system: {
    all: ["v1", "system"] as const,
    settings: () => ["v1", "system", "settings"] as const,
    timezone: () => ["v1", "system", "timezone"] as const,
  },
  sensitiveWords: {
    all: ["v1", "sensitive-words"] as const,
    list: () => ["v1", "sensitive-words", "list"] as const,
    cacheStats: () => ["v1", "sensitive-words", "cache", "stats"] as const,
  },
  errorRules: {
    all: ["v1", "error-rules"] as const,
    list: () => ["v1", "error-rules", "list"] as const,
    cacheStats: () => ["v1", "error-rules", "cache", "stats"] as const,
  },
  requestFilters: {
    all: ["v1", "request-filters"] as const,
    list: () => ["v1", "request-filters", "list"] as const,
    providerOptions: () => ["v1", "request-filters", "options", "providers"] as const,
    groupOptions: () => ["v1", "request-filters", "options", "groups"] as const,
  },
  publicStatus: {
    all: ["v1", "public-status"] as const,
    current: (params?: Record<string, unknown>) =>
      ["v1", "public-status", "current", params ?? {}] as const,
    settings: () => ["v1", "public-status", "settings"] as const,
  },
  ipGeo: {
    all: ["v1", "ip-geo"] as const,
    lookup: (ip: string, lang?: string) => ["v1", "ip-geo", ip, lang ?? ""] as const,
  },
  adminUserInsights: {
    all: ["v1", "admin-user-insights"] as const,
    overview: (userId: number, params?: Record<string, unknown>) =>
      ["v1", "admin-user-insights", userId, "overview", params ?? {}] as const,
    keyTrend: (userId: number, params?: Record<string, unknown>) =>
      ["v1", "admin-user-insights", userId, "key-trend", params ?? {}] as const,
    modelBreakdown: (userId: number, params?: Record<string, unknown>) =>
      ["v1", "admin-user-insights", userId, "model-breakdown", params ?? {}] as const,
    providerBreakdown: (userId: number, params?: Record<string, unknown>) =>
      ["v1", "admin-user-insights", userId, "provider-breakdown", params ?? {}] as const,
  },
  auditLogs: {
    all: ["v1", "audit-logs"] as const,
    list: (params?: Record<string, unknown>) => ["v1", "audit-logs", "list", params ?? {}] as const,
    detail: (id: number) => ["v1", "audit-logs", "detail", id] as const,
  },
  modelPrices: {
    all: ["v1", "model-prices"] as const,
    list: (params?: Record<string, unknown>) =>
      ["v1", "model-prices", "list", params ?? {}] as const,
    catalog: (params?: Record<string, unknown>) =>
      ["v1", "model-prices", "catalog", params ?? {}] as const,
    exists: () => ["v1", "model-prices", "exists"] as const,
    detail: (modelName: string) => ["v1", "model-prices", "detail", modelName] as const,
  },
  dashboard: {
    all: ["v1", "dashboard"] as const,
    overview: () => ["v1", "dashboard", "overview"] as const,
    statistics: (params?: Record<string, unknown>) =>
      ["v1", "dashboard", "statistics", params ?? {}] as const,
    concurrentSessions: () => ["v1", "dashboard", "concurrent-sessions"] as const,
    realtime: () => ["v1", "dashboard", "realtime"] as const,
    providerSlots: () => ["v1", "dashboard", "provider-slots"] as const,
    rateLimitStats: (params?: Record<string, unknown>) =>
      ["v1", "dashboard", "rate-limit-stats", params ?? {}] as const,
    proxyStatus: () => ["v1", "dashboard", "proxy-status"] as const,
    clientVersions: () => ["v1", "dashboard", "client-versions"] as const,
  },
  sessions: {
    all: ["v1", "sessions"] as const,
    list: (params?: Record<string, unknown>) => ["v1", "sessions", "list", params ?? {}] as const,
    detail: (sessionId: string, params?: Record<string, unknown>) =>
      ["v1", "sessions", "detail", sessionId, params ?? {}] as const,
    messages: (sessionId: string, params?: Record<string, unknown>) =>
      ["v1", "sessions", "messages", sessionId, params ?? {}] as const,
    requests: (sessionId: string, params?: Record<string, unknown>) =>
      ["v1", "sessions", "requests", sessionId, params ?? {}] as const,
    originChain: (sessionId: string) => ["v1", "sessions", "origin-chain", sessionId] as const,
    response: (sessionId: string) => ["v1", "sessions", "response", sessionId] as const,
  },
  usageLogs: {
    all: ["v1", "usage-logs"] as const,
    list: (params?: Record<string, unknown>) => ["v1", "usage-logs", "list", params ?? {}] as const,
    stats: (params?: Record<string, unknown>) =>
      ["v1", "usage-logs", "stats", params ?? {}] as const,
    filterOptions: () => ["v1", "usage-logs", "filter-options"] as const,
    sessionSuggestions: (params?: Record<string, unknown>) =>
      ["v1", "usage-logs", "session-id-suggestions", params ?? {}] as const,
    exportStatus: (jobId: string) => ["v1", "usage-logs", "exports", jobId] as const,
  },
  me: {
    all: ["v1", "me"] as const,
    metadata: () => ["v1", "me", "metadata"] as const,
    quota: () => ["v1", "me", "quota"] as const,
    today: () => ["v1", "me", "today"] as const,
    usageLogs: (params?: Record<string, unknown>) =>
      ["v1", "me", "usage-logs", params ?? {}] as const,
    usageLogsFull: (params?: Record<string, unknown>) =>
      ["v1", "me", "usage-logs", "full", params ?? {}] as const,
    usageModels: () => ["v1", "me", "usage-logs", "models"] as const,
    usageEndpoints: () => ["v1", "me", "usage-logs", "endpoints"] as const,
    statsSummary: (params?: Record<string, unknown>) =>
      ["v1", "me", "usage-logs", "stats-summary", params ?? {}] as const,
    ipGeo: (ip: string, lang?: string) => ["v1", "me", "ip-geo", ip, lang ?? ""] as const,
  },
  providerEndpoints: {
    all: ["v1", "provider-endpoints"] as const,
    vendors: (params?: Record<string, unknown>) =>
      ["v1", "provider-endpoints", "vendors", params ?? {}] as const,
    vendor: (vendorId: number) => ["v1", "provider-endpoints", "vendor", vendorId] as const,
    endpoints: (vendorId: number, params?: Record<string, unknown>) =>
      ["v1", "provider-endpoints", "vendor", vendorId, "endpoints", params ?? {}] as const,
    endpointCircuit: (endpointId: number) =>
      ["v1", "provider-endpoints", endpointId, "circuit"] as const,
    vendorCircuit: (vendorId: number, providerType: string) =>
      ["v1", "provider-endpoints", "vendor", vendorId, "circuit", providerType] as const,
  },
} as const;
