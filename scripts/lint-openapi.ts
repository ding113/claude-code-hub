const { mock } = await import("bun:test");
mock.module("server-only", () => ({}));

const [{ app }, { buildOpenApiDocument }] = await Promise.all([
  import("@/app/api/v1/_root/app"),
  import("@/app/api/v1/_root/document"),
]);

const document = buildOpenApiDocument(app) as {
  paths?: Record<string, Record<string, unknown>>;
};

const methods = new Set(["get", "post", "put", "patch", "delete", "options"]);
const failures: string[] = [];

for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!methods.has(method)) continue;
    const op = operation as {
      summary?: string;
      description?: string;
      tags?: string[];
      responses?: Record<string, unknown>;
      security?: Array<Record<string, string[]>>;
      "x-required-access"?: string;
    };
    const label = `${method.toUpperCase()} ${path}`;
    if (!path.startsWith("/api/v1/")) failures.push(`${label}: path must start with /api/v1/`);
    if (!op.summary) failures.push(`${label}: missing summary`);
    if (!op.description) failures.push(`${label}: missing description`);
    if (!op.tags?.length) failures.push(`${label}: missing tags`);
    if (!["public", "read", "admin"].includes(op["x-required-access"] ?? "")) {
      failures.push(`${label}: missing x-required-access`);
    }
    if (!op.responses || Object.keys(op.responses).length === 0) {
      failures.push(`${label}: missing responses`);
    }
    const normalizedPath = path.replace(/^\/api\/v1/, "");
    if (
      normalizedPath !== "/health" &&
      !op.security?.length &&
      !normalizedPath.startsWith("/public/status")
    ) {
      failures.push(`${label}: missing security declaration`);
    }
  }
}

const serialized = JSON.stringify(document);
for (const hiddenProviderType of ["claude-auth", "gemini-cli"]) {
  if (serialized.includes(hiddenProviderType)) {
    failures.push(`OpenAPI document exposes hidden provider type ${hiddenProviderType}`);
  }
}

if (failures.length > 0) {
  console.error("OpenAPI lint failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("OpenAPI lint passed");
