import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// CJS helper — server.js is a Node CJS entry, not part of the Next build.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyStandaloneNextConfig } = require("../../server-lib/standalone-config");

type LogCall = { level: string; event: string; payload: Record<string, unknown> };

function makeLog(): {
  calls: LogCall[];
  fn: (l: string, e: string, p: Record<string, unknown>) => void;
} {
  const calls: LogCall[] = [];
  return {
    calls,
    fn: (level, event, payload) => {
      calls.push({ level, event, payload });
    },
  };
}

describe("applyStandaloneNextConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cch-standalone-"));
    fs.mkdirSync(path.join(tmpDir, ".next"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads config from .next/required-server-files.json into the env var (regression: standalone build dropped overrides)", () => {
    const config = {
      experimental: {
        proxyClientMaxBodySize: 104857600, // 100MB — the override that was being silently dropped
        serverActions: { bodySizeLimit: "500mb" },
      },
      output: "standalone",
    };
    fs.writeFileSync(
      path.join(tmpDir, ".next", "required-server-files.json"),
      JSON.stringify({ config })
    );
    const env: Record<string, string | undefined> = {};
    const log = makeLog();

    const result = applyStandaloneNextConfig({ rootDir: tmpDir, env, log: log.fn });

    expect(result).toMatchObject({ applied: true });
    expect(env.__NEXT_PRIVATE_STANDALONE_CONFIG).toBeDefined();
    const parsed = JSON.parse(env.__NEXT_PRIVATE_STANDALONE_CONFIG ?? "");
    expect(parsed.experimental.proxyClientMaxBodySize).toBe(104857600);
    expect(parsed.experimental.serverActions.bodySizeLimit).toBe("500mb");
    expect(log.calls).toHaveLength(0);
  });

  it("does not overwrite an env var that is already set (operator override wins)", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".next", "required-server-files.json"),
      JSON.stringify({ config: { experimental: { proxyClientMaxBodySize: 1 } } })
    );
    const preset = JSON.stringify({ experimental: { proxyClientMaxBodySize: 999 } });
    const env: Record<string, string | undefined> = { __NEXT_PRIVATE_STANDALONE_CONFIG: preset };

    const result = applyStandaloneNextConfig({ rootDir: tmpDir, env });

    expect(result).toEqual({ applied: false, reason: "preset" });
    expect(env.__NEXT_PRIVATE_STANDALONE_CONFIG).toBe(preset);
  });

  it("logs and returns gracefully when manifest is missing (e.g. dev mode without next build)", () => {
    const env: Record<string, string | undefined> = {};
    const log = makeLog();

    const result = applyStandaloneNextConfig({ rootDir: tmpDir, env, log: log.fn });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("load_error");
    expect(env.__NEXT_PRIVATE_STANDALONE_CONFIG).toBeUndefined();
    expect(log.calls).toHaveLength(1);
    expect(log.calls[0]).toMatchObject({
      level: "warn",
      event: "standalone_config_load_failed",
    });
  });

  it("returns missing_config when manifest exists but lacks the config field", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".next", "required-server-files.json"),
      JSON.stringify({ version: 1 }) // no `config` key
    );
    const env: Record<string, string | undefined> = {};
    const log = makeLog();

    const result = applyStandaloneNextConfig({ rootDir: tmpDir, env, log: log.fn });

    expect(result).toEqual({ applied: false, reason: "missing_config" });
    expect(env.__NEXT_PRIVATE_STANDALONE_CONFIG).toBeUndefined();
    expect(log.calls).toHaveLength(1);
    expect(log.calls[0].event).toBe("standalone_config_missing_field");
  });

  it("rejects misuse with a clear error", () => {
    expect(() => applyStandaloneNextConfig({ rootDir: tmpDir })).toThrow(/env object/);
    expect(() => applyStandaloneNextConfig({ env: {} })).toThrow(/rootDir/);
  });
});
