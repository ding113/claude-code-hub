import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("deploy/Dockerfile runtime contract", () => {
  it("runs as node with writable, environment-redacted diagnostic reports", () => {
    const dockerfile = readFileSync(resolve(process.cwd(), "deploy/Dockerfile"), "utf8");
    const reportsDirectory = "RUN mkdir -p /app/reports && chown node:node /app/reports";
    const user = "USER node";
    const command =
      'CMD ["node", "--report-on-fatalerror", "--report-uncaught-exception", "--report-exclude-env", "--report-directory=/app/reports", "server.js"]';

    expect(dockerfile).toContain(reportsDirectory);
    expect(dockerfile).toContain(user);
    expect(dockerfile).toContain(command);
    expect(dockerfile.indexOf(reportsDirectory)).toBeLessThan(dockerfile.indexOf(user));
    expect(dockerfile.indexOf(user)).toBeLessThan(dockerfile.indexOf(command));
  });
});
