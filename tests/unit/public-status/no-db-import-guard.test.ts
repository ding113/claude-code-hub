import { describe, expect, it } from "vitest";
import {
  listStaticImports,
  readRepoFile,
  repoPath,
} from "../../helpers/public-status-test-helpers";

const guardedFiles = [
  "src/app/api/public-status/route.ts",
  "src/lib/public-status/read-store.ts",
  "src/app/[locale]/status/page.tsx",
];

const bannedImports = [
  "@/drizzle/db",
  "@/repository/system-config",
  "@/repository/model-price",
  "@/lib/availability/availability-service",
  "@/lib/proxy-status-tracker",
];

const bannedTokens = ["findLatestPriceByModel", "getSystemSettings", "queryProviderAvailability"];

describe("public-status no-db import guard", () => {
  it("keeps public request-path files away from DB-backed modules", async () => {
    for (const relativePath of guardedFiles) {
      const source = await readRepoFile(relativePath);
      const imports = listStaticImports(source);

      for (const bannedImport of bannedImports) {
        expect(imports, `${repoPath(relativePath)} must not import ${bannedImport}`).not.toContain(
          bannedImport
        );
      }

      for (const bannedToken of bannedTokens) {
        expect(source, `${repoPath(relativePath)} must not reference ${bannedToken}`).not.toContain(
          bannedToken
        );
      }
    }
  });
});
