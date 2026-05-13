export type ManagementApiAccess = "public" | "read" | "admin";

export type ActionMigrationEntry = {
  module: string;
  sourceFile: string;
  resource: string;
  endpointFamilies: string[];
  access: ManagementApiAccess;
  exportPolicy: "all-action-exports" | "internal-only";
  internalOnlyReason?: string;
  excludedExports?: Record<string, string>;
};

export type ActionExportClassification = {
  module: string;
  sourceFile: string;
  exportName: string;
  policy: "endpoint" | "internal-only";
  resource?: string;
  access?: ManagementApiAccess;
  endpointFamilies?: readonly string[];
  reason?: string;
};

export type ClientActionImportAllowlistEntry = {
  module: string;
  ownerTask: 15 | 16 | 17 | 18;
  reason: string;
};

export const ACTION_MIGRATION_MATRIX = [
  {
    module: "users",
    sourceFile: "users.ts",
    resource: "users",
    endpointFamilies: ["/api/v1/users", "/api/v1/users:batchUpdate"],
    access: "admin",
    exportPolicy: "all-action-exports",
    excludedExports: {
      syncUserProviderGroupFromKeys:
        "Internal consistency helper invoked by key mutations; not a standalone public operation.",
    },
  },
  {
    module: "keys",
    sourceFile: "keys.ts",
    resource: "keys",
    endpointFamilies: [
      "/api/v1/users/{userId}/keys",
      "/api/v1/keys/{keyId}",
      "/api/v1/keys/{keyId}:reveal",
    ],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "key-quota",
    sourceFile: "key-quota.ts",
    resource: "me/keys",
    endpointFamilies: ["/api/v1/me/quota", "/api/v1/keys/{keyId}/quota"],
    access: "read",
    exportPolicy: "all-action-exports",
  },
  {
    module: "providers",
    sourceFile: "providers.ts",
    resource: "providers",
    endpointFamilies: ["/api/v1/providers", "/api/v1/providers/{providerId}/key:reveal"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "provider-endpoints",
    sourceFile: "provider-endpoints.ts",
    resource: "provider-endpoints",
    endpointFamilies: ["/api/v1/provider-vendors", "/api/v1/provider-endpoints/{endpointId}"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "provider-groups",
    sourceFile: "provider-groups.ts",
    resource: "provider-groups",
    endpointFamilies: ["/api/v1/provider-groups"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "model-prices",
    sourceFile: "model-prices.ts",
    resource: "model-prices",
    endpointFamilies: ["/api/v1/model-prices", "/api/v1/model-prices:syncLitellm"],
    access: "admin",
    exportPolicy: "all-action-exports",
    excludedExports: {
      processPriceTableInternal: "Internal helper; never exposed as management API.",
    },
  },
  {
    module: "usage-logs",
    sourceFile: "usage-logs.ts",
    resource: "usage-logs",
    endpointFamilies: ["/api/v1/usage-logs", "/api/v1/usage-logs/exports"],
    access: "read",
    exportPolicy: "all-action-exports",
  },
  {
    module: "my-usage",
    sourceFile: "my-usage.ts",
    resource: "me",
    endpointFamilies: ["/api/v1/me/usage-logs", "/api/v1/me/quota"],
    access: "read",
    exportPolicy: "all-action-exports",
  },
  {
    module: "audit-logs",
    sourceFile: "audit-logs.ts",
    resource: "audit-logs",
    endpointFamilies: ["/api/v1/audit-logs"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "active-sessions",
    sourceFile: "active-sessions.ts",
    resource: "sessions",
    endpointFamilies: ["/api/v1/sessions", "/api/v1/sessions/{sessionId}"],
    access: "read",
    exportPolicy: "all-action-exports",
  },
  {
    module: "active-sessions-utils",
    sourceFile: "active-sessions-utils.ts",
    resource: "internal",
    endpointFamilies: [],
    access: "admin",
    exportPolicy: "internal-only",
    internalOnlyReason: "Utility module used by session actions; not a public API surface.",
  },
  {
    module: "concurrent-sessions",
    sourceFile: "concurrent-sessions.ts",
    resource: "dashboard",
    endpointFamilies: ["/api/v1/dashboard/concurrent-sessions"],
    access: "read",
    exportPolicy: "all-action-exports",
  },
  {
    module: "session-response",
    sourceFile: "session-response.ts",
    resource: "sessions",
    endpointFamilies: ["/api/v1/sessions/{sessionId}/response"],
    access: "read",
    exportPolicy: "all-action-exports",
  },
  {
    module: "session-origin-chain",
    sourceFile: "session-origin-chain.ts",
    resource: "sessions",
    endpointFamilies: ["/api/v1/sessions/{sessionId}/origin-chain"],
    access: "read",
    exportPolicy: "all-action-exports",
  },
  {
    module: "statistics",
    sourceFile: "statistics.ts",
    resource: "dashboard",
    endpointFamilies: ["/api/v1/dashboard/statistics"],
    access: "read",
    exportPolicy: "all-action-exports",
  },
  {
    module: "overview",
    sourceFile: "overview.ts",
    resource: "dashboard",
    endpointFamilies: ["/api/v1/dashboard/overview"],
    access: "read",
    exportPolicy: "all-action-exports",
  },
  {
    module: "dashboard-realtime",
    sourceFile: "dashboard-realtime.ts",
    resource: "dashboard",
    endpointFamilies: ["/api/v1/dashboard/realtime"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "admin-user-insights",
    sourceFile: "admin-user-insights.ts",
    resource: "admin-user-insights",
    endpointFamilies: ["/api/v1/admin/users/{userId}/insights"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "sensitive-words",
    sourceFile: "sensitive-words.ts",
    resource: "sensitive-words",
    endpointFamilies: ["/api/v1/sensitive-words"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "notifications",
    sourceFile: "notifications.ts",
    resource: "notifications",
    endpointFamilies: ["/api/v1/notifications/settings"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "notification-bindings",
    sourceFile: "notification-bindings.ts",
    resource: "notification-bindings",
    endpointFamilies: ["/api/v1/notifications/types/{type}/bindings"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "webhook-targets",
    sourceFile: "webhook-targets.ts",
    resource: "webhook-targets",
    endpointFamilies: ["/api/v1/webhook-targets"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "system-config",
    sourceFile: "system-config.ts",
    resource: "system",
    endpointFamilies: ["/api/v1/system/settings", "/api/v1/system/timezone"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "request-filters",
    sourceFile: "request-filters.ts",
    resource: "request-filters",
    endpointFamilies: ["/api/v1/request-filters"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "error-rules",
    sourceFile: "error-rules.ts",
    resource: "error-rules",
    endpointFamilies: ["/api/v1/error-rules"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "rate-limit-stats",
    sourceFile: "rate-limit-stats.ts",
    resource: "dashboard",
    endpointFamilies: ["/api/v1/dashboard/rate-limit-stats"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "proxy-status",
    sourceFile: "proxy-status.ts",
    resource: "dashboard",
    endpointFamilies: ["/api/v1/dashboard/proxy-status"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "dispatch-simulator",
    sourceFile: "dispatch-simulator.ts",
    resource: "dashboard",
    endpointFamilies: ["/api/v1/dashboard/dispatch-simulator:simulate"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "public-status",
    sourceFile: "public-status.ts",
    resource: "public-status",
    endpointFamilies: ["/api/v1/public/status"],
    access: "public",
    exportPolicy: "all-action-exports",
  },
  {
    module: "provider-slots",
    sourceFile: "provider-slots.ts",
    resource: "dashboard",
    endpointFamilies: ["/api/v1/dashboard/provider-slots"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
  {
    module: "client-versions",
    sourceFile: "client-versions.ts",
    resource: "dashboard",
    endpointFamilies: ["/api/v1/dashboard/client-versions"],
    access: "admin",
    exportPolicy: "all-action-exports",
  },
] as const satisfies readonly ActionMigrationEntry[];

export const CLIENT_ACTION_IMPORT_ALLOWLIST: readonly ClientActionImportAllowlistEntry[] = [];

export function getMigrationEntryByModule(module: string): ActionMigrationEntry | undefined {
  return ACTION_MIGRATION_MATRIX.find((entry) => entry.module === module);
}

export function classifyActionExport(
  module: string,
  exportName: string
): ActionExportClassification | undefined {
  const entry = getMigrationEntryByModule(module);
  if (!entry) return undefined;

  if (entry.exportPolicy === "internal-only") {
    return {
      module,
      sourceFile: entry.sourceFile,
      exportName,
      policy: "internal-only",
      reason: entry.internalOnlyReason,
    };
  }

  const excludedReason = entry.excludedExports?.[exportName];
  if (excludedReason) {
    return {
      module,
      sourceFile: entry.sourceFile,
      exportName,
      policy: "internal-only",
      reason: excludedReason,
    };
  }

  return {
    module,
    sourceFile: entry.sourceFile,
    exportName,
    policy: "endpoint",
    resource: entry.resource,
    access: entry.access,
    endpointFamilies: entry.endpointFamilies,
  };
}

export function getClientActionImportOwner(
  module: string
): ClientActionImportAllowlistEntry | undefined {
  return CLIENT_ACTION_IMPORT_ALLOWLIST.find((entry) => entry.module === module);
}
