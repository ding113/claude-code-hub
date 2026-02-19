#!/usr/bin/env bun

import postgres from "postgres";

if (!process.env.DSN && process.env.DATABASE_URL) {
  process.env.DSN = process.env.DATABASE_URL;
}

type CountCheckRow = {
  message_request_count: number;
  usage_ledger_count: number;
};

type CostCheckRow = {
  message_total_cost: string;
  ledger_total_cost: string;
  is_equal: boolean;
};

type WarmupLeakRow = {
  warmup_leak_count: number;
};

type OrphanRow = {
  orphan_ledger_count: number;
};

function getFirstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) {
    throw new Error("expected query to return one row");
  }
  return row;
}

async function main(): Promise<void> {
  const dsn = process.env.DSN;
  if (!dsn) {
    console.log("[SKIP] DSN/DATABASE_URL not configured, skipping ledger consistency verification.");
    process.exit(0);
  }

  const client = postgres(dsn, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 5,
  });

  try {
    const countRow = getFirstRow<CountCheckRow>(await client`
      SELECT
        (
          SELECT COUNT(*)::integer
          FROM message_request
          WHERE blocked_by IS DISTINCT FROM 'warmup'
        ) AS message_request_count,
        (
          SELECT COUNT(*)::integer
          FROM usage_ledger
        ) AS usage_ledger_count
    `);

    const costRow = getFirstRow<CostCheckRow>(await client`
      WITH message_sum AS (
        SELECT COALESCE(SUM(cost_usd), 0) AS total_cost
        FROM message_request
        WHERE blocked_by IS DISTINCT FROM 'warmup'
      ),
      ledger_sum AS (
        SELECT COALESCE(SUM(cost_usd), 0) AS total_cost
        FROM usage_ledger
      )
      SELECT
        message_sum.total_cost::text AS message_total_cost,
        ledger_sum.total_cost::text AS ledger_total_cost,
        (message_sum.total_cost = ledger_sum.total_cost) AS is_equal
      FROM message_sum, ledger_sum
    `);

    const warmupRow = getFirstRow<WarmupLeakRow>(await client`
      SELECT COUNT(*)::integer AS warmup_leak_count
      FROM usage_ledger
      WHERE blocked_by = 'warmup'
    `);

    const orphanRow = getFirstRow<OrphanRow>(await client`
      SELECT COUNT(*)::integer AS orphan_ledger_count
      FROM usage_ledger ul
      LEFT JOIN message_request mr ON mr.id = ul.request_id
      WHERE mr.id IS NULL
    `);

    console.log("Ledger consistency verification");
    console.log("=============================");
    console.log(
      `Count parity: message_request(non-warmup)=${countRow.message_request_count}, usage_ledger=${countRow.usage_ledger_count}`
    );
    console.log(
      `Cost parity: message_request=${costRow.message_total_cost}, usage_ledger=${costRow.ledger_total_cost}`
    );
    console.log(`Warmup leak count in usage_ledger: ${warmupRow.warmup_leak_count}`);
    console.log(`Orphan ledger rows (expected/OK after log deletion): ${orphanRow.orphan_ledger_count}`);

    const criticalIssues: string[] = [];

    if (countRow.message_request_count !== countRow.usage_ledger_count) {
      criticalIssues.push("count mismatch");
    }

    if (!costRow.is_equal) {
      criticalIssues.push("cost mismatch");
    }

    if (warmupRow.warmup_leak_count > 0) {
      criticalIssues.push("warmup rows leaked into usage_ledger");
    }

    if (criticalIssues.length > 0) {
      console.error(`RESULT: FAILED (${criticalIssues.join(", ")})`);
      process.exit(1);
    }

    console.log("RESULT: PASS (no critical mismatches)");
    process.exit(0);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Ledger consistency verification failed with error:", error);
  process.exit(1);
});
