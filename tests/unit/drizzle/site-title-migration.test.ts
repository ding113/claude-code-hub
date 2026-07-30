import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface JournalEntry {
  idx: number;
  tag: string;
}

interface MigrationJournal {
  entries: JournalEntry[];
}

const readMigrationFile = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("site title migration", () => {
  it("runs after the TTFB migration and preserves both schema changes", () => {
    const journal = JSON.parse(
      readMigrationFile("drizzle/meta/_journal.json")
    ) as MigrationJournal;
    const indexes = journal.entries.map(({ idx }) => idx);
    const snapshotSource = readMigrationFile("drizzle/meta/0115_snapshot.json");

    expect(new Set(indexes).size).toBe(indexes.length);
    expect(journal.entries.slice(-2).map(({ idx, tag }) => ({ idx, tag }))).toEqual([
      { idx: 114, tag: "0114_overconfident_ronan" },
      { idx: 115, tag: "0115_breezy_polaris" },
    ]);
    expect(snapshotSource).toContain('"first_byte_ms"');
    expect(snapshotSource).toContain("'CC Hub'");
  });

  it("updates only titles that still use the legacy default", () => {
    const migration = readMigrationFile("drizzle/0115_breezy_polaris.sql");

    expect(migration).toContain(
      `ALTER TABLE "system_settings" ALTER COLUMN "site_title" SET DEFAULT 'CC Hub'`
    );
    expect(migration).toContain(
      `UPDATE "system_settings" SET "site_title" = 'CC Hub' WHERE "site_title" = 'Claude Code Hub'`
    );
  });
});
