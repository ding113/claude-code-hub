/**
 * Allowlist of legacy client-side imports from `@/actions/*`.
 *
 * Each entry pins one (clientFile, importedActionModule) pair to a Wave 4
 * task that is responsible for replacing it with a `/api/v1` API client
 * call. As tasks 15-18 land, entries must be removed; by the end of Task
 * 18 this allowlist must be empty.
 *
 * Domain split per the migration plan:
 *  - Task 15: my-usage / overview / quotas / dashboard read panels
 *  - Task 16: users / keys / providers / model-prices / admin-user-insights
 *  - Task 17: system config / notifications / rules / webhooks / public status
 *  - Task 18: logs / audit / sessions / dispatch-simulator / shared types
 *
 * The static gate (`client-action-import-inventory.test.ts`) enforces:
 *  - Every current `'use client'` file that imports `@/actions/*` is listed
 *    here exactly once, with a `task` of 15 / 16 / 17 / 18.
 *  - Any new unlisted client import is rejected.
 */

export type AllowlistTask = 15 | 16 | 17 | 18;

export interface ClientActionImportEntry {
  /** Path relative to repo root, using forward slashes. */
  file: string;
  /** Action module slug, matching `src/actions/<module>.ts`. */
  module: string;
  /** Wave 4 task that owns the migration. */
  task: AllowlistTask;
  /**
   * Optional flag for type-only imports. The gate still requires the entry
   * but later removal can happen as soon as types are inlined or moved.
   */
  typeOnly?: true;
}

export const clientActionImportAllowlist: readonly ClientActionImportEntry[] = [
  // ---------------------------------------------------------------------
  // Task 15: my-usage / overview / quotas / dashboard read panels
  // ---------------------------------------------------------------------
  {
    file: "src/app/[locale]/dashboard/_components/user/key-quota-usage-dialog.tsx",
    module: "key-quota",
    task: 15,
  },

  // ---------------------------------------------------------------------
  // Task 16: users / keys / providers / model-prices / admin-user-insights
  // ---------------------------------------------------------------------
  {
    file: "src/app/[locale]/dashboard/_components/rate-limit-top-users.tsx",
    module: "users",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/batch-edit/batch-edit-dialog.tsx",
    module: "keys",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/batch-edit/batch-edit-dialog.tsx",
    module: "users",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/create-user-dialog.tsx",
    module: "keys",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/create-user-dialog.tsx",
    module: "users",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/edit-user-dialog.tsx",
    module: "users",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/forms/add-key-form.tsx",
    module: "keys",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/forms/add-key-form.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/forms/edit-key-form.tsx",
    module: "keys",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/forms/edit-key-form.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/forms/provider-group-select.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/forms/user-form.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/forms/user-form.tsx",
    module: "users",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/hooks/use-model-suggestions.ts",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/key-quota-usage-dialog.tsx",
    module: "keys",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/key-row-item.tsx",
    module: "keys",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/user-key-table-row.tsx",
    module: "keys",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/user-key-table-row.tsx",
    module: "users",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/_components/user/user-management-table.tsx",
    module: "users",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/leaderboard/user/[userId]/_components/filters/user-insights-filter-bar.tsx",
    module: "keys",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/leaderboard/user/[userId]/_components/filters/user-insights-filter-bar.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/leaderboard/user/[userId]/_components/user-key-trend-chart.tsx",
    module: "admin-user-insights",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/leaderboard/user/[userId]/_components/user-model-breakdown.tsx",
    module: "admin-user-insights",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/leaderboard/user/[userId]/_components/user-overview-cards.tsx",
    module: "admin-user-insights",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/leaderboard/user/[userId]/_components/user-provider-breakdown.tsx",
    module: "admin-user-insights",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/quotas/keys/_components/edit-key-quota-dialog.tsx",
    module: "keys",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/quotas/keys/_components/edit-user-quota-dialog.tsx",
    module: "users",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/quotas/keys/_components/keys-quota-client.tsx",
    module: "keys",
    task: 16,
  },
  {
    file: "src/app/[locale]/dashboard/users/users-page-client.tsx",
    module: "users",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/prices/_components/delete-model-dialog.tsx",
    module: "model-prices",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/prices/_components/model-price-dialog.tsx",
    module: "model-prices",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/prices/_components/model-price-drawer.tsx",
    module: "model-prices",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/prices/_components/provider-pricing-dialog.tsx",
    module: "model-prices",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/prices/_components/sync-litellm-button.tsx",
    module: "model-prices",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/prices/_components/upload-price-dialog.tsx",
    module: "model-prices",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/auto-sort-priority-dialog.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/batch-edit/provider-batch-dialog.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/batch-edit/provider-batch-preview-step.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/forms/api-test-button.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/forms/provider-form/index.tsx",
    module: "provider-endpoints",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/forms/provider-form/index.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/forms/proxy-test-button.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/model-multi-select.tsx",
    module: "model-prices",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/model-multi-select.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/provider-endpoint-hover.tsx",
    module: "provider-endpoints",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/provider-endpoints-table.tsx",
    module: "provider-endpoints",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/provider-group-tab.tsx",
    module: "provider-groups",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/provider-group-tab.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/provider-list-item.legacy.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/provider-list.tsx",
    module: "provider-endpoints",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/provider-manager-loader.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/provider-rich-list-item.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/provider-vendor-view.tsx",
    module: "provider-endpoints",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/recluster-vendors-dialog.tsx",
    module: "providers",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/vendor-keys-compact-list.tsx",
    module: "provider-endpoints",
    task: 16,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/vendor-keys-compact-list.tsx",
    module: "providers",
    task: 16,
  },

  // ---------------------------------------------------------------------
  // Task 17: system config / notifications / rules / webhooks / public status
  // ---------------------------------------------------------------------
  {
    file: "src/app/[locale]/dashboard/_components/webhook-migration-dialog.tsx",
    module: "notifications",
    task: 17,
  },
  {
    file: "src/app/[locale]/dashboard/availability/_components/endpoint-probe-history.tsx",
    module: "provider-endpoints",
    task: 17,
  },
  {
    file: "src/app/[locale]/dashboard/availability/_components/endpoint/endpoint-tab.tsx",
    module: "provider-endpoints",
    task: 17,
  },
  {
    file: "src/app/[locale]/dashboard/rate-limits/_components/rate-limit-dashboard.tsx",
    module: "rate-limit-stats",
    task: 17,
  },
  {
    file: "src/app/[locale]/dashboard/rate-limits/_components/rate-limit-filters.tsx",
    module: "providers",
    task: 17,
  },
  {
    file: "src/app/[locale]/dashboard/rate-limits/_components/rate-limit-filters.tsx",
    module: "users",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/client-versions/_components/client-version-toggle.tsx",
    module: "system-config",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/config/_components/system-settings-form.tsx",
    module: "system-config",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/error-rules/_components/add-rule-dialog.tsx",
    module: "error-rules",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/error-rules/_components/edit-rule-dialog.tsx",
    module: "error-rules",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/error-rules/_components/error-rule-tester.tsx",
    module: "error-rules",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/error-rules/_components/refresh-cache-button.tsx",
    module: "error-rules",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/error-rules/_components/rule-list-table.tsx",
    module: "error-rules",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/notifications/_lib/hooks.ts",
    module: "notification-bindings",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/notifications/_lib/hooks.ts",
    module: "notifications",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/notifications/_lib/hooks.ts",
    module: "webhook-targets",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/dispatch-simulator-dialog.tsx",
    module: "dispatch-simulator",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/providers/_components/forms/provider-form/index.tsx",
    module: "request-filters",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/request-filters/_components/filter-dialog.tsx",
    module: "request-filters",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/request-filters/_components/filter-table.tsx",
    module: "request-filters",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/request-filters/_components/group-multi-select.tsx",
    module: "request-filters",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/request-filters/_components/provider-multi-select.tsx",
    module: "request-filters",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/sensitive-words/_components/add-word-dialog.tsx",
    module: "sensitive-words",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/sensitive-words/_components/edit-word-dialog.tsx",
    module: "sensitive-words",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/sensitive-words/_components/refresh-cache-button.tsx",
    module: "sensitive-words",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/sensitive-words/_components/word-list-table.tsx",
    module: "sensitive-words",
    task: 17,
  },
  {
    file: "src/app/[locale]/settings/status-page/_components/public-status-settings-form.tsx",
    module: "public-status",
    task: 17,
  },

  // ---------------------------------------------------------------------
  // Task 18: logs / audit / sessions / dispatch-simulator / shared types
  // ---------------------------------------------------------------------
  {
    file: "src/app/[locale]/dashboard/logs/_components/error-details-dialog/components/LogicTraceTab.tsx",
    module: "session-origin-chain",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/logs/_components/error-details-dialog/index.tsx",
    module: "active-sessions",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/logs/_components/filters/identity-filters.tsx",
    module: "keys",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/logs/_components/filters/identity-filters.tsx",
    module: "users",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/logs/_components/filters/request-filters.tsx",
    module: "usage-logs",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/logs/_components/usage-logs-filters.tsx",
    module: "usage-logs",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/logs/_components/usage-logs-stats-panel.tsx",
    module: "usage-logs",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/logs/_components/usage-logs-view-virtualized.tsx",
    module: "keys",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/logs/_components/usage-logs-view-virtualized.tsx",
    module: "overview",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/logs/_components/usage-logs-view-virtualized.tsx",
    module: "providers",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/logs/_components/virtualized-logs-table.tsx",
    module: "types",
    task: 18,
    typeOnly: true,
  },
  {
    file: "src/app/[locale]/dashboard/logs/_components/virtualized-logs-table.tsx",
    module: "usage-logs",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/logs/_hooks/use-lazy-filter-options.ts",
    module: "types",
    task: 18,
    typeOnly: true,
  },
  {
    file: "src/app/[locale]/dashboard/logs/_hooks/use-lazy-filter-options.ts",
    module: "usage-logs",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/sessions/_components/active-sessions-client.tsx",
    module: "active-sessions",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/sessions/_components/active-sessions-table.tsx",
    module: "active-sessions",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/sessions/_components/session-messages-dialog.tsx",
    module: "active-sessions",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/sessions/[sessionId]/messages/_components/request-list-sidebar.tsx",
    module: "active-sessions",
    task: 18,
  },
  {
    file: "src/app/[locale]/dashboard/sessions/[sessionId]/messages/_components/session-messages-client.tsx",
    module: "active-sessions",
    task: 18,
  },
  {
    file: "src/components/customs/active-sessions-cards.tsx",
    module: "active-sessions",
    task: 18,
  },
  {
    file: "src/components/customs/active-sessions-list.tsx",
    module: "active-sessions",
    task: 18,
  },
];
