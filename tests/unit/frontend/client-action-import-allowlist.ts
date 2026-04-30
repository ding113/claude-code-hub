/**
 * Allowlist of legacy client-side imports from `@/actions/*`.
 *
 * Each entry pins one (clientFile, importedActionModule) pair to a Wave 4
 * task that is responsible for replacing it with a `/api/v1` API client
 * call. Wave 4 has now drained the list to zero — the inventory gate runs
 * in strict mode against an empty allowlist.
 *
 * Domain split (historical, kept for documentation):
 *  - Task 15: my-usage / overview / quotas / dashboard read panels
 *  - Task 16: users / keys / providers / model-prices / admin-user-insights
 *  - Task 17: system config / notifications / rules / webhooks / public status
 *  - Task 18: logs / audit / sessions / dispatch-simulator / shared types
 *
 * The static gate (`client-action-import-inventory.test.ts`) enforces:
 *  - No `'use client'` file imports `@/actions/*`. Any new client-side
 *    coupling MUST be migrated to a `/api/v1` hook (or routed through
 *    `src/lib/api-client/v1/legacy-action.ts` if the v1 endpoint is still
 *    pending) before merging.
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

export const clientActionImportAllowlist: readonly ClientActionImportEntry[] = [];
