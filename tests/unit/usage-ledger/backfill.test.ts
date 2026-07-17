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
