#!/usr/bin/env bun
/**
 * Initialize default error rules
 * 
 * Usage: bun run scripts/init-error-rules.ts
 * 
 * This script inserts 7 default error rules into the error_rules table.
 * It uses ON CONFLICT DO NOTHING to ensure idempotency.
 */

import { initializeDefaultErrorRules } from "@/repository/error-rules";

async function main() {
  console.log("Initializing default error rules...");
  
  try {
    await initializeDefaultErrorRules();
    console.log("✓ Default error rules initialized successfully");
  } catch (error) {
    console.error("✗ Failed to initialize default error rules:", error);
    process.exit(1);
  }
}

main();
