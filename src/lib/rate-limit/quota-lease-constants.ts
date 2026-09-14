/**
 * Quota lease constants shared by server code and the settings UI (no server imports).
 */

/** Lease refresh interval used when the setting is missing or invalid. */
export const DEFAULT_LEASE_TTL_SECONDS = 10;

/** In high-concurrency mode the effective lease refresh interval is at least this long. */
export const HIGH_CONCURRENCY_MIN_LEASE_TTL_SECONDS = 30;
