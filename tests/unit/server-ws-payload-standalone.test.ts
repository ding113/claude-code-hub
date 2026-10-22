import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";

const requireFromHere = createRequire(import.meta.url);
const sourceRoot = path.resolve(import.meta.dirname, "../..");
let temporary: string | undefined;
afterEach(() => {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
});

describe("custom server standalone payload error resources", () => {
  it("copies the helpers and their dependencies into an independently located artifact", async () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cch-ws-standalone-"));
    const artifact = path.join(temporary, ".next/standalone");
    fs.mkdirSync(artifact, { recursive: true });
    for (const file of ["server.js", "cluster.js"]) {
      fs.copyFileSync(path.join(sourceRoot, file), path.join(temporary, file));
    }
    fs.cpSync(path.join(sourceRoot, "server-lib"), path.join(temporary, "server-lib"), {
      recursive: true,
    });
    for (const locale of locales) {
      fs.mkdirSync(path.join(temporary, "messages", locale), { recursive: true });
      fs.copyFileSync(
        path.join(sourceRoot, "messages", locale, "errors.json"),
        path.join(temporary, "messages", locale, "errors.json")
      );
    }
    const { nodeFileTrace } = requireFromHere("next/dist/compiled/@vercel/nft");
    const { fileList } = await nodeFileTrace(
      [path.join(sourceRoot, "server-lib/responses-ws-error-message.js")],
      { base: sourceRoot, processCwd: sourceRoot }
    );
    for (const file of fileList as Set<string>) {
      if (!file.startsWith("node_modules/")) continue;
      const target = path.join(temporary, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(path.join(sourceRoot, file), target, { recursive: true, dereference: true });
    }
    execFileSync(
      process.execPath,
      [path.join(sourceRoot, "scripts/copy-custom-server-to-standalone.cjs")],
      { cwd: temporary }
    );
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        `
      const Module = require("node:module");
      const path = require("node:path");
      const artifact = process.cwd() + path.sep;
      const originalResolve = Module._resolveFilename;
      Module._resolveFilename = function (request, ...args) {
        const resolved = originalResolve.call(this, request, ...args);
        if (!Module.isBuiltin(resolved) && !resolved.startsWith(artifact)) {
          throw new Error("Dependency escaped the standalone artifact: " + resolved);
        }
        return resolved;
      };
      const { formatWsPayloadTooLargeMessage } = require("./server-lib/responses-ws-error-message");
      console.log(JSON.stringify(${JSON.stringify(locales)}.map(locale =>
        formatWsPayloadTooLargeMessage({ "accept-language": locale }, 101 * 1024 * 1024, 100 * 1024 * 1024)
      )));
    `,
      ],
      { cwd: artifact, env: { ...process.env, NODE_ENV: "production" }, encoding: "utf8" }
    );
    const messages = JSON.parse(output) as string[];
    expect(messages).toHaveLength(locales.length);
    expect(messages.every((message) => message.includes("101.00"))).toBe(true);
    for (const locale of locales) {
      expect(fs.readFileSync(path.join(artifact, "messages", locale, "errors.json"), "utf8")).toBe(
        fs.readFileSync(path.join(sourceRoot, "messages", locale, "errors.json"), "utf8")
      );
    }
  });
});
