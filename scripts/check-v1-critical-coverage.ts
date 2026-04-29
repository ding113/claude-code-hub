import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type CoverageMetric = Record<string, number>;

type CoverageFile = {
  statementMap: Record<string, unknown>;
  fnMap: Record<string, unknown>;
  branchMap: Record<string, { locations?: unknown[] }>;
  s: CoverageMetric;
  f: CoverageMetric;
  b: Record<string, number[]>;
};

const coveragePath = path.join(process.cwd(), "coverage", "coverage-final.json");
const threshold = 80;

const criticalFiles = [
  "src/app/api/v1/resources/system/handlers.ts",
  "src/app/api/v1/resources/public/handlers.ts",
  "src/app/api/v1/resources/notifications/handlers.ts",
  "src/app/api/v1/resources/webhook-targets/handlers.ts",
  "src/lib/api/v1/_shared/action-bridge.ts",
];

function percent(covered: number, total: number): number {
  return total === 0 ? 100 : (covered / total) * 100;
}

function summarize(file: CoverageFile) {
  const statementsTotal = Object.keys(file.statementMap).length;
  const statementsCovered = Object.values(file.s).filter((count) => count > 0).length;
  const functionsTotal = Object.keys(file.fnMap).length;
  const functionsCovered = Object.values(file.f).filter((count) => count > 0).length;
  const branchesTotal = Object.values(file.branchMap).reduce(
    (sum, branch) => sum + (branch.locations?.length ?? 0),
    0
  );
  const branchesCovered = Object.values(file.b).reduce(
    (sum, counts) => sum + counts.filter((count) => count > 0).length,
    0
  );

  return {
    statements: percent(statementsCovered, statementsTotal),
    functions: percent(functionsCovered, functionsTotal),
    branches: percent(branchesCovered, branchesTotal),
  };
}

if (!existsSync(coveragePath)) {
  console.error(`Missing coverage file: ${coveragePath}`);
  process.exit(1);
}

const coverage = JSON.parse(readFileSync(coveragePath, "utf8")) as Record<string, CoverageFile>;
const failures: string[] = [];

for (const expectedPath of criticalFiles) {
  const entry = Object.entries(coverage).find(([actualPath]) => actualPath.endsWith(expectedPath));
  if (!entry) {
    failures.push(`${expectedPath}: missing from coverage report`);
    continue;
  }

  const summary = summarize(entry[1]);
  for (const metric of ["statements", "functions", "branches"] as const) {
    if (summary[metric] < threshold) {
      failures.push(`${expectedPath}: ${metric} ${summary[metric].toFixed(1)}% < ${threshold}%`);
    }
  }
}

if (failures.length > 0) {
  console.error("Critical v1 coverage check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Critical v1 coverage check passed");
