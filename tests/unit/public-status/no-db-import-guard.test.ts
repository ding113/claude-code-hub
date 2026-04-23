import { describe, expect, it } from "vitest";
import {
  listStaticImports,
  readRepoFile,
  repoPath,
} from "../../helpers/public-status-test-helpers";

const guardedFiles = [
  "src/app/api/public-status/route.ts",
  "src/app/api/public-site-meta/route.ts",
  "src/app/[locale]/status/page.tsx",
  "src/app/[locale]/status/[slug]/page.tsx",
  "src/app/[locale]/layout.tsx",
  "src/lib/public-status/public-api-loader.ts",
  "src/lib/public-status/read-store.ts",
  "src/lib/public-status/config-snapshot.ts",
  "src/lib/public-status/layout-metadata.ts",
];

const bannedImports = [
  "@/drizzle/db",
  "@/repository/system-config",
  "@/repository/model-price",
  "@/lib/availability/availability-service",
  "@/lib/proxy-status-tracker",
];

const bannedTokens = ["findLatestPriceByModel", "getSystemSettings", "queryProviderAvailability"];
const directTokenGuardFiles = new Set([
  "src/app/api/public-status/route.ts",
  "src/app/api/public-site-meta/route.ts",
  "src/app/[locale]/status/page.tsx",
  "src/app/[locale]/status/[slug]/page.tsx",
  "src/app/[locale]/layout.tsx",
  "src/lib/public-status/public-api-loader.ts",
  "src/lib/public-status/read-store.ts",
]);

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

      if (directTokenGuardFiles.has(relativePath)) {
        for (const bannedToken of bannedTokens) {
          expect(
            source,
            `${repoPath(relativePath)} must not reference ${bannedToken}`
          ).not.toContain(bannedToken);
        }
      }
    }
  });
});
