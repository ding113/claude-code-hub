import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("deploy/Dockerfile runtime contract", () => {
  it("builds with real Node and the repository Bun version", () => {
    const dockerfile = readFileSync(resolve(process.cwd(), "deploy/Dockerfile"), "utf8");
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as { engines: { node: string } };
    const bunVersion = readFileSync(resolve(process.cwd(), ".bun-version"), "utf8").trim();

    expect(packageJson.engines.node).toBe(">=22.19.0");
    expect(dockerfile).toContain(
      `FROM --platform=$BUILDPLATFORM oven/bun:${bunVersion}-debian AS bun-runtime`
    );
    expect(dockerfile).toContain("FROM --platform=$BUILDPLATFORM node:trixie-slim AS build-base");
    expect(dockerfile).toContain("COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun");
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
