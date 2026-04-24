import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

process.env.DSN = "";

vi.mock("@/drizzle/db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, sql: actual.sql };
});

const { backfillUsageLedger } = await import("@/lib/ledger-backfill");

const serviceSource = readFileSync(
  resolve(process.cwd(), "src/lib/ledger-backfill/service.ts"),
  "utf-8"
);

describe("backfillUsageLedger", () => {
  it("exports backfillUsageLedger function", () => {
    expect(typeof backfillUsageLedger).toBe("function");
  });

  it("uses ON CONFLICT in backfill SQL", () => {
    expect(serviceSource).toContain("ON CONFLICT");
  });

  it("uses ON CONFLICT DO UPDATE in backfill SQL", () => {
    expect(serviceSource).toContain("DO UPDATE");
  });

  it("computes success_rate_outcome during backfill", () => {
    expect(serviceSource).toContain("success_rate_outcome");
    expect(serviceSource).toContain("fn_compute_message_request_success_rate_outcome");
  });
});
