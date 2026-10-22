import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import semver from "semver";
import { describe, expect, it } from "vitest";

// CVE-2026-111497（Brotli 解码越界写入）的修复版本：22.23.4 / 24.22.1 / 26.12.1
const PATCHED_NODE_ENGINES = "^22.23.4 || ^24.22.1 || >=26.12.1";

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("deploy/Dockerfile runtime contract", () => {
  it("builds with real Node and the repository Bun version", () => {
    const dockerfile = readRepoFile("deploy/Dockerfile");
    const packageJson = JSON.parse(readRepoFile("package.json")) as { engines: { node: string } };
    const bunVersion = readRepoFile(".bun-version").trim();
    const nodeVersion = readRepoFile(".node-version").trim();

    expect(packageJson.engines.node).toBe(PATCHED_NODE_ENGINES);
    expect(dockerfile).toContain(
      `FROM --platform=$BUILDPLATFORM oven/bun:${bunVersion}-debian AS bun-runtime`
    );
    expect(dockerfile).toContain(
      `FROM --platform=$BUILDPLATFORM node:${nodeVersion}-trixie-slim AS build-base`
    );
    expect(dockerfile).toContain("COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun");
  });

  it("pins every Node image to the .node-version release that carries the Brotli decoder fix", () => {
    const nodeVersion = readRepoFile(".node-version").trim();
    const nodeImage = `node:${nodeVersion}-trixie-slim`;

    expect(semver.valid(nodeVersion)).toBe(nodeVersion);
    expect(semver.satisfies(nodeVersion, PATCHED_NODE_ENGINES)).toBe(true);

    for (const file of ["deploy/Dockerfile", "deploy/Dockerfile.dev", "Dockerfile"]) {
      const dockerfile = readRepoFile(file);
      const nodeImages = Array.from(dockerfile.matchAll(/^FROM\s+(?:--\S+\s+)*(node:\S+)/gm)).map(
        (match) => match[1]
      );

      expect(nodeImages.length, file).toBeGreaterThan(0);
      for (const image of nodeImages) {
        expect(image, file).toBe(nodeImage);
      }
      expect(dockerfile, file).toContain(`FROM ${nodeImage} AS runner`);
    }
  });

  it("sets up CI Node from .node-version", () => {
    for (const file of [
      ".github/workflows/dev.yml",
      ".github/workflows/pr-check.yml",
      ".github/workflows/release.yml",
    ]) {
      const workflow = readRepoFile(file);

      expect(workflow, file).toContain("uses: actions/setup-node@");
      expect(workflow, file).toContain("node-version-file: .node-version");
      expect(workflow, file).not.toMatch(/^\s*node-version:/m);
    }
  });

  it("runs as node with writable, environment-redacted diagnostic reports", () => {
    const dockerfile = readFileSync(resolve(process.cwd(), "deploy/Dockerfile"), "utf8");
    const reportsDirectory = "RUN mkdir -p /app/reports && chown node:node /app/reports";
    const user = "USER node";
    const command =
      'CMD ["node", "--report-on-fatalerror", "--report-uncaught-exception", "--report-exclude-env", "--report-directory=/app/reports", "cluster.js"]';

    expect(dockerfile).toContain(reportsDirectory);
    expect(dockerfile).toContain(user);
    expect(dockerfile).toContain(command);
    expect(dockerfile.indexOf(reportsDirectory)).toBeLessThan(dockerfile.indexOf(user));
    expect(dockerfile.indexOf(user)).toBeLessThan(dockerfile.indexOf(command));
  });
});
