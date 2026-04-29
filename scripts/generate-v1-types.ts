import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import openapiTS, { astToString } from "openapi-typescript";

const outputPath = path.join(process.cwd(), "src/lib/api-client/v1/openapi-types.gen.ts");
const checkOnly = process.argv.includes("--check");

const { mock } = await import("bun:test");
mock.module("server-only", () => ({}));

const [{ app }, { buildOpenApiDocument }] = await Promise.all([
  import("@/app/api/v1/_root/app"),
  import("@/app/api/v1/_root/document"),
]);

const document = buildOpenApiDocument(app);
const ast = await openapiTS(document);
const generated = `// AUTO-GENERATED - DO NOT EDIT\n${astToString(ast)}\n`;

if (checkOnly) {
  const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
  if (current !== generated) {
    console.error("Generated OpenAPI types are out of date. Run `bun run openapi:generate`.");
    process.exit(1);
  }
  process.exit(0);
}

writeFileSync(outputPath, generated);
