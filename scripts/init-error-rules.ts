#!/usr/bin/env bun
/**
 * Sync default error rules
 *
 * Usage: bun run scripts/init-error-rules.ts
 *
 * This script syncs DEFAULT_ERROR_RULES to the database with "user-first" strategy:
 * - If pattern doesn't exist: insert new rule
 * - If pattern exists and isDefault=true: update to latest
 * - If pattern exists and isDefault=false: skip (preserve user customization)
 */

import { syncDefaultErrorRules } from "@/repository/error-rules";

async function main() {
  console.log("Syncing default error rules...");

  try {
    const result = await syncDefaultErrorRules();
    console.log(
      `✓ Default error rules synced: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped, ${result.deleted} deleted`
    );
  } catch (error) {
    console.error("✗ Failed to sync default error rules:", error);
    process.exit(1);
  }
}

main();
