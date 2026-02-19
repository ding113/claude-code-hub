import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serviceTs = readFileSync(resolve(process.cwd(), "src/lib/log-cleanup/service.ts"), "utf-8");
const usersTs = readFileSync(resolve(process.cwd(), "src/actions/users.ts"), "utf-8");

describe("usage_ledger cleanup immunity", () => {
  it("log cleanup service never imports or queries usageLedger", () => {
    expect(serviceTs).not.toContain("import.*usageLedger");
    expect(serviceTs).not.toMatch(/from.*schema.*usageLedger/);
    expect(serviceTs).not.toContain("db.delete(usageLedger)");
    expect(serviceTs).not.toContain('from("usage_ledger")');
    expect(serviceTs).not.toContain("FROM usage_ledger");
  });

  it("removeUser does not delete from usageLedger", () => {
    const removeUserMatch = usersTs.match(/export async function removeUser[\s\S]*?^}/m);
    expect(removeUserMatch).not.toBeNull();
    const removeUserBody = removeUserMatch![0];
    expect(removeUserBody).not.toContain("db.delete(usageLedger)");
  });

  it("resetUserAllStatistics deletes from both tables", () => {
    const resetMatch = usersTs.match(/export async function resetUserAllStatistics[\s\S]*?^}/m);
    expect(resetMatch).not.toBeNull();
    const resetBody = resetMatch![0];
    expect(resetBody).toContain("db.delete(messageRequest)");
    expect(resetBody).toContain("db.delete(usageLedger)");
  });

  it("resetUserAllStatistics is the only usageLedger delete path in users.ts", () => {
    const allDeleteMatches = [...usersTs.matchAll(/db\.delete\(usageLedger\)/g)];
    expect(allDeleteMatches).toHaveLength(1);

    const deleteIndex = usersTs.indexOf("db.delete(usageLedger)");
    const precedingChunk = usersTs.slice(Math.max(0, deleteIndex - 2000), deleteIndex);
    expect(precedingChunk).toContain("resetUserAllStatistics");
  });
});
