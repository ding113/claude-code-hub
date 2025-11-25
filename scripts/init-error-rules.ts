#!/usr/bin/env bun
/**
 * Sync default error rules
 *
 * Usage: bun run scripts/init-error-rules.ts
 *
 * This script syncs DEFAULT_ERROR_RULES to the database:
 * - Deletes all existing default rules (isDefault=true)
 * - Re-inserts the latest default rules
 * - User-created rules (isDefault=false) are preserved
 */

import { syncDefaultErrorRules } from "@/repository/error-rules";

async function main() {
  console.log("Syncing default error rules...");

  try {
    const count = await syncDefaultErrorRules();
    console.log(`✓ Default error rules synced successfully (${count} rules)`);
  } catch (error) {
    console.error("✗ Failed to sync default error rules:", error);
    process.exit(1);
  }
}

main();
