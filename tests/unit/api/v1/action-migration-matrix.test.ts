import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  ACTION_MIGRATION_MATRIX,
  classifyActionExport,
  getMigrationEntryByModule,
} from "@/lib/api/v1/action-migration-matrix";
import { app } from "@/app/api/v1/_root/app";
import { buildOpenApiDocument } from "@/app/api/v1/_root/document";

const actionsDir = path.join(process.cwd(), "src/actions");

function moduleNameFromFile(fileName: string): string {
  return fileName.replace(/\.ts$/, "");
}

function exportedFunctionNames(fileName: string): string[] {
  const source = readFileSync(path.join(actionsDir, fileName), "utf8");
  const names = new Set<string>();
  const patterns = [
    /export\s+async\s+function\s+([A-Za-z0-9_]+)/g,
    /export\s+function\s+([A-Za-z0-9_]+)/g,
    /export\s+const\s+([A-Za-z0-9_]+)\s*=/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      names.add(match[1]);
    }
  }

  return [...names].sort();
}

describe("v1 action migration matrix", () => {
  test("covers every action module except shared types", () => {
    const actionFiles = readdirSync(actionsDir)
      .filter((fileName) => fileName.endsWith(".ts"))
      .filter((fileName) => fileName !== "types.ts")
      .sort();

    const matrixFiles = ACTION_MIGRATION_MATRIX.map((entry) => entry.sourceFile).sort();
    expect(matrixFiles).toEqual(actionFiles);
  });

  test("maps or explicitly excludes every exported action function", () => {
    const missing: string[] = [];
    const endpointless: string[] = [];

    for (const entry of ACTION_MIGRATION_MATRIX) {
      const exportedFunctions = exportedFunctionNames(entry.sourceFile);
      for (const exportName of exportedFunctions) {
        const classification = classifyActionExport(entry.module, exportName);
        if (!classification) {
          missing.push(`${entry.sourceFile}:${exportName}`);
          continue;
        }

        if (classification.policy === "internal-only") {
          expect(classification.reason).toBeTruthy();
          continue;
        }

        if (!classification.endpointFamilies || classification.endpointFamilies.length === 0) {
          endpointless.push(`${entry.sourceFile}:${exportName}`);
        }
      }
    }

    expect(missing).toEqual([]);
    expect(endpointless).toEqual([]);
  });

  test("classifies critical exports at symbol level", () => {
    expect(classifyActionExport("providers", "getUnmaskedProviderKey")).toMatchObject({
      policy: "endpoint",
      resource: "providers",
    });
    expect(classifyActionExport("model-prices", "processPriceTableInternal")).toMatchObject({
      policy: "internal-only",
    });
    expect(
      classifyActionExport("active-sessions-utils", "summarizeTerminateSessionsBatch")
    ).toMatchObject({
      policy: "internal-only",
    });
    expect(classifyActionExport("users", "syncUserProviderGroupFromKeys")).toMatchObject({
      policy: "internal-only",
    });
  });

  test("has stable entries for modules called out by the migration plan", () => {
    const expectedModules = [
      "users",
      "keys",
      "key-quota",
      "providers",
      "provider-endpoints",
      "provider-groups",
      "model-prices",
      "usage-logs",
      "my-usage",
      "audit-logs",
      "active-sessions",
      "active-sessions-utils",
      "concurrent-sessions",
      "session-response",
      "session-origin-chain",
      "statistics",
      "overview",
      "dashboard-realtime",
      "admin-user-insights",
      "sensitive-words",
      "notifications",
      "notification-bindings",
      "webhook-targets",
      "system-config",
      "request-filters",
      "error-rules",
      "rate-limit-stats",
      "proxy-status",
      "dispatch-simulator",
      "public-status",
      "provider-slots",
      "client-versions",
    ];

    expect(ACTION_MIGRATION_MATRIX.map((entry) => entry.module).sort()).toEqual(
      expectedModules.sort()
    );
    expect(getMigrationEntryByModule("active-sessions-utils")?.exportPolicy).toBe("internal-only");
    expect(getMigrationEntryByModule("model-prices")?.excludedExports).toHaveProperty(
      "processPriceTableInternal"
    );
  });

  test("documents every endpoint family declared by the matrix", () => {
    const document = buildOpenApiDocument(app);
    const documentedPaths = Object.keys(document.paths ?? {}).map(normalizeDocumentedPath);
    const missing = ACTION_MIGRATION_MATRIX.flatMap((entry) =>
      entry.endpointFamilies
        .map(normalizeDocumentedPath)
        .filter(
          (pathName) =>
            pathName &&
            !documentedPaths.some(
              (documentedPath) =>
                documentedPath === pathName || documentedPath.startsWith(`${pathName}/`)
            )
        )
        .map((pathName) => `${entry.module}:${pathName}`)
    );

    expect(missing).toEqual([]);
  });
});

function normalizeDocumentedPath(pathName: string): string {
  return pathName.replace(/^\/api\/v1/, "").replace(/\{[^}]+\}/g, "{}");
}
