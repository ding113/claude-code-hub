/**
 * Action-to-Endpoint migration matrix for the `/api/v1` REST surface.
 *
 * This file is the single source of truth that maps every existing
 * `src/actions/*.ts` module to its target REST resource, access tier, and
 * endpoint family. It is enforced by:
 *  - tests/unit/api/v1/action-migration-matrix.test.ts
 *  - subsequent resource-task tests that pin the exact endpoint mapping
 *
 * Rules:
 *  - EVERY top-level `src/actions/*.ts` file must appear as a key in
 *    `actionMigrationMatrix`. Silent omissions are forbidden.
 *  - Modules that intentionally do not become public REST endpoints (e.g.
 *    pure type modules, internal helpers) MUST be marked with
 *    `internalOnly: true` and a `notes` rationale.
 *  - Per-export internal exclusions (e.g. helpers exported from an otherwise
 *    public module) live in `internalOnlySymbols` so they are visible to the
 *    static gate without polluting the public matrix.
 */

/**
 * Access tier indicates the default permission boundary for the REST
 * resource. Modules that mix self-scoped read with admin-only write use
 * `mixed` and should declare per-endpoint policy at handler implementation
 * time.
 */
export type ActionAccessTier = "public" | "read" | "admin" | "mixed";

/**
 * Single matrix entry.
 */
export interface ActionMigrationEntry {
  /**
   * Target REST resource segment under `/api/v1` (e.g. "users", "dashboard").
   * For internal-only modules this is the literal string "internal-only".
   */
  targetResource: string;
  /**
   * Default access tier for the resource family. Individual endpoints can
   * tighten or relax this value at handler time, but the default must not
   * be more permissive than what the legacy action enforces.
   */
  accessTier: ActionAccessTier;
  /**
   * Concrete endpoint family that the action module is expected to back.
   * Empty for internal-only modules.
   */
  endpointFamily: readonly string[];
  /**
   * Free-form rationale, especially required when `internalOnly` is true.
   */
  notes?: string;
  /**
   * If true the action is explicitly excluded from the public REST surface
   * and must not be exposed via `/api/v1/*`.
   */
  internalOnly?: true;
}

/**
 * Matrix keyed by `src/actions/<key>.ts` filename without extension.
 *
 * Source: openapi-rest-migration-close-1123.md, section
 * "Action-to-Endpoint Migration Matrix".
 */
export const actionMigrationMatrix = {
  users: {
    targetResource: "users",
    accessTier: "mixed",
    endpointFamily: [
      "/api/v1/users",
      "/api/v1/users/{userId}",
      "/api/v1/users:batchUpdate",
      "/api/v1/users/{userId}/limits:reset",
      "/api/v1/users/tags",
      "/api/v1/users/key-groups",
    ],
    notes: "Covers search, list, CRUD, renew, enable, stats/limits reset.",
  },
  keys: {
    targetResource: "keys",
    accessTier: "mixed",
    endpointFamily: [
      "/api/v1/users/{userId}/keys",
      "/api/v1/keys/{keyId}",
      "/api/v1/keys/{keyId}:enable",
      "/api/v1/keys:batchUpdate",
    ],
    notes: "Key secret returned only once on create.",
  },
  "key-quota": {
    targetResource: "keys",
    accessTier: "mixed",
    endpointFamily: ["/api/v1/me/quota", "/api/v1/keys/{keyId}/quota"],
    notes: "Consolidate with my-usage/key limit endpoints.",
  },
  providers: {
    targetResource: "providers",
    accessTier: "admin",
    endpointFamily: [
      "/api/v1/providers",
      "/api/v1/providers/{providerId}",
      "/api/v1/providers/{providerId}/key:reveal",
      "/api/v1/providers/{providerId}/circuit:reset",
      "/api/v1/providers:test",
      "/api/v1/providers:autoSortPriority",
    ],
    notes: "Includes provider search and true key reveal.",
  },
  "provider-endpoints": {
    targetResource: "provider-vendors",
    accessTier: "admin",
    endpointFamily: [
      "/api/v1/provider-vendors",
      "/api/v1/provider-vendors/{vendorId}/endpoints",
      "/api/v1/provider-endpoints/{endpointId}:probe",
      "/api/v1/provider-endpoints/{endpointId}/circuit:reset",
      "/api/v1/provider-vendors/{vendorId}/circuit:reset",
    ],
    notes: "Preserve vendor/endpoint distinction; covers vendor and endpoint level circuits.",
  },
  "provider-groups": {
    targetResource: "provider-groups",
    accessTier: "admin",
    endpointFamily: ["/api/v1/provider-groups", "/api/v1/provider-groups/{groupId}"],
    notes: "Was missing from legacy OpenAPI.",
  },
  "model-prices": {
    targetResource: "model-prices",
    accessTier: "mixed",
    endpointFamily: [
      "/api/v1/model-prices",
      "/api/v1/model-prices/{modelName}",
      "/api/v1/model-prices:syncLitellm",
      "/api/v1/model-prices:upload",
    ],
    notes: "processPriceTableInternal remains internal-only.",
  },
  "usage-logs": {
    targetResource: "usage-logs",
    accessTier: "mixed",
    endpointFamily: [
      "/api/v1/usage-logs",
      "/api/v1/usage-logs/stats",
      "/api/v1/usage-logs/exports",
    ],
    notes: "Cursor pagination; async export routes.",
  },
  "my-usage": {
    targetResource: "me",
    accessTier: "read",
    endpointFamily: [
      "/api/v1/me/metadata",
      "/api/v1/me/quota",
      "/api/v1/me/today",
      "/api/v1/me/usage-logs",
      "/api/v1/me/ip-geo/{ip}",
    ],
    notes: "Any valid key can call self-scoped read routes.",
  },
  "audit-logs": {
    targetResource: "audit-logs",
    accessTier: "admin",
    endpointFamily: ["/api/v1/audit-logs", "/api/v1/audit-logs/{auditLogId}"],
    notes: "Cursor pagination.",
  },
  "active-sessions": {
    targetResource: "sessions",
    accessTier: "mixed",
    endpointFamily: [
      "/api/v1/sessions",
      "/api/v1/sessions/{sessionId}",
      "/api/v1/sessions/{sessionId}/messages",
      "/api/v1/sessions:batchTerminate",
    ],
    notes: "Self-scope for read where action supports it.",
  },
  "active-sessions-utils": {
    targetResource: "internal-only",
    accessTier: "admin",
    endpointFamily: [],
    internalOnly: true,
    notes:
      "Pure helper module (`summarizeTerminateSessionsBatch` plus shared types). Not exposed via REST; consumed by active-sessions handlers.",
  },
  "concurrent-sessions": {
    targetResource: "dashboard",
    accessTier: "mixed",
    endpointFamily: ["/api/v1/dashboard/concurrent-sessions"],
    notes: "Was missing from legacy OpenAPI.",
  },
  "session-response": {
    targetResource: "sessions",
    accessTier: "mixed",
    endpointFamily: ["/api/v1/sessions/{sessionId}/response"],
    notes: "Was missing from legacy OpenAPI.",
  },
  "session-origin-chain": {
    targetResource: "sessions",
    accessTier: "mixed",
    endpointFamily: ["/api/v1/sessions/{sessionId}/origin-chain"],
    notes: "Was missing from legacy OpenAPI.",
  },
  statistics: {
    targetResource: "dashboard",
    accessTier: "read",
    endpointFamily: ["/api/v1/dashboard/statistics"],
    notes: "Existing stats semantics preserved.",
  },
  overview: {
    targetResource: "dashboard",
    accessTier: "read",
    endpointFamily: ["/api/v1/dashboard/overview"],
    notes: "Existing overview semantics preserved.",
  },
  "dashboard-realtime": {
    targetResource: "dashboard",
    accessTier: "admin",
    endpointFamily: ["/api/v1/dashboard/realtime"],
    notes: "Was missing from legacy OpenAPI.",
  },
  "admin-user-insights": {
    targetResource: "admin-user-insights",
    accessTier: "admin",
    endpointFamily: [
      "/api/v1/admin/users/{userId}/insights/overview",
      "/api/v1/admin/users/{userId}/insights/key-trend",
      "/api/v1/admin/users/{userId}/insights/model-breakdown",
      "/api/v1/admin/users/{userId}/insights/provider-breakdown",
    ],
    notes: "Dedicated admin namespace under /api/v1/admin.",
  },
  "sensitive-words": {
    targetResource: "sensitive-words",
    accessTier: "admin",
    endpointFamily: [
      "/api/v1/sensitive-words",
      "/api/v1/sensitive-words/{id}",
      "/api/v1/sensitive-words/cache:refresh",
      "/api/v1/sensitive-words/cache/stats",
    ],
    notes: "Existing CRUD plus cache refresh/stats.",
  },
  notifications: {
    targetResource: "notifications",
    accessTier: "admin",
    endpointFamily: ["/api/v1/notifications/settings", "/api/v1/notifications/test-webhook"],
    notes: "Settings use PUT.",
  },
  "notification-bindings": {
    targetResource: "notification-bindings",
    accessTier: "admin",
    endpointFamily: ["/api/v1/notifications/types/{type}/bindings"],
    notes: "Was missing from legacy OpenAPI.",
  },
  "webhook-targets": {
    targetResource: "webhook-targets",
    accessTier: "admin",
    endpointFamily: [
      "/api/v1/webhook-targets",
      "/api/v1/webhook-targets/{targetId}",
      "/api/v1/webhook-targets/{targetId}:test",
    ],
    notes: "Vertical slice resource.",
  },
  "system-config": {
    targetResource: "system",
    accessTier: "mixed",
    endpointFamily: ["/api/v1/system/settings", "/api/v1/system/timezone"],
    notes: "Was missing from legacy OpenAPI.",
  },
  "request-filters": {
    targetResource: "request-filters",
    accessTier: "admin",
    endpointFamily: [
      "/api/v1/request-filters",
      "/api/v1/request-filters/{id}",
      "/api/v1/request-filters/cache:refresh",
      "/api/v1/request-filters/options/providers",
      "/api/v1/request-filters/options/provider-groups",
    ],
    notes: "Was missing from legacy OpenAPI.",
  },
  "error-rules": {
    targetResource: "error-rules",
    accessTier: "admin",
    endpointFamily: [
      "/api/v1/error-rules",
      "/api/v1/error-rules/{id}",
      "/api/v1/error-rules/cache:refresh",
      "/api/v1/error-rules/cache/stats",
      "/api/v1/error-rules:test",
    ],
    notes: "Was missing from legacy OpenAPI.",
  },
  "rate-limit-stats": {
    targetResource: "dashboard",
    accessTier: "admin",
    endpointFamily: ["/api/v1/dashboard/rate-limit-stats"],
    notes: "Was missing from legacy OpenAPI.",
  },
  "proxy-status": {
    targetResource: "dashboard",
    accessTier: "admin",
    endpointFamily: ["/api/v1/dashboard/proxy-status"],
    notes: "Was missing from legacy OpenAPI.",
  },
  "dispatch-simulator": {
    targetResource: "dispatch-simulator",
    accessTier: "admin",
    endpointFamily: ["/api/v1/dispatch-simulator:run", "/api/v1/dispatch-simulator:decisionTree"],
    notes: "Admin-only diagnostic; not public.",
  },
  "public-status": {
    targetResource: "public-status",
    accessTier: "mixed",
    endpointFamily: ["/api/v1/public/status", "/api/v1/public/status/settings"],
    notes: "Public read; admin settings write.",
  },
  "provider-slots": {
    targetResource: "dashboard",
    accessTier: "admin",
    endpointFamily: ["/api/v1/dashboard/provider-slots"],
    notes: "Was missing from legacy OpenAPI.",
  },
  "client-versions": {
    targetResource: "dashboard",
    accessTier: "admin",
    endpointFamily: ["/api/v1/dashboard/client-versions"],
    notes: "Was missing from legacy OpenAPI.",
  },
  types: {
    targetResource: "internal-only",
    accessTier: "read",
    endpointFamily: [],
    internalOnly: true,
    notes:
      "Shared ActionResult/SuccessResult/ErrorResult contract; pure types, no runtime surface.",
  },
} as const satisfies Readonly<Record<string, ActionMigrationEntry>>;

/**
 * Per-symbol exclusions. Use when a module is otherwise mapped to a public
 * resource family but exports specific helpers/internal procedures that
 * must not be exposed via REST.
 *
 * Keyed by the same module slug as `actionMigrationMatrix`. Each entry maps
 * the exported symbol name to a rationale string.
 */
export const internalOnlySymbols = {
  "model-prices": {
    processPriceTableInternal:
      "Internal price-table parsing helper invoked by uploadPriceTable; never directly exposed.",
  },
} as const satisfies Readonly<Record<string, Readonly<Record<string, string>>>>;

export type ActionMigrationKey = keyof typeof actionMigrationMatrix;
