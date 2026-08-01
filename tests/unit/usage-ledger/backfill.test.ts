import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DSN = "";

const mockTransaction = vi.hoisted(() => vi.fn());

vi.mock("@/drizzle/db", () => ({
  db: {
    execute: vi.fn(),
    transaction: mockTransaction,
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
  beforeEach(() => {
    mockTransaction.mockReset();
  });

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

  it("repairs Session identity and Replay provenance in existing ledger rows", () => {
    const projectionFields = [
      "session_identity",
      "session_identity_kind",
      "affinity_scope_tag",
      "affinity_fingerprint",
      "affinity_fingerprint_chain",
      "is_replay",
      "replay_source_request_id",
    ];

    for (const field of projectionFields) {
      expect(serviceSource).toContain(`mr.${field}`);
      expect(serviceSource).toContain(`${field} = EXCLUDED.${field}`);
      expect(serviceSource).toContain(`ul.${field} IS DISTINCT FROM mr.${field}`);
    }
  });

  it("forces Replay rows to zero cost during backfill", () => {
    expect(serviceSource).toContain("CASE WHEN mr.is_replay THEN 0 ELSE mr.cost_usd END");
    expect(serviceSource).toContain("mr.is_replay AND ul.cost_usd IS DISTINCT FROM 0");
  });

  it("keeps the recovery projection aligned with the trigger", () => {
    expect(serviceSource).toContain("mr.group_cost_multiplier");
    expect(serviceSource).toContain("mr.client_ip");
    expect(serviceSource).toContain("mr.status_code IS NULL OR mr.status_code < 400");
    expect(serviceSource).toContain("group_cost_multiplier = EXCLUDED.group_cost_multiplier");
    expect(serviceSource).toContain("client_ip = EXCLUDED.client_ip");
    expect(serviceSource).toContain("is_success = EXCLUDED.is_success");
  });

  it("rejects before opening a transaction when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(backfillUsageLedger(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("observes abort after a batch and does not start another batch", async () => {
    const controller = new AbortController();
    let resolveBatch!: (value: unknown[]) => void;
    const batch = new Promise<unknown[]>((resolve) => {
      resolveBatch = resolve;
    });
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ acquired: true }])
      .mockReturnValueOnce(batch)
      .mockResolvedValueOnce([{ processed: 0, inserted: 0, updated: 0, max_id: 0 }]);
    mockTransaction.mockImplementation(async (callback) => callback({ execute }));

    const backfill = backfillUsageLedger(controller.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    resolveBatch([{ processed: 1, inserted: 1, updated: 0, max_id: 1 }]);

    await expect(backfill).rejects.toMatchObject({ name: "AbortError" });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
