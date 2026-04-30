/**
 * /api/v1 类型生成漂移检测。
 *
 * 验证：
 * - 已提交的 `src/lib/api-client/v1/openapi-types.gen.ts` 首行包含 AUTO-GENERATED 头；
 * - `bun scripts/generate-v1-types.ts --check` 退出码为 0（即文件与当前 OpenAPI 同步）。
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const GENERATED_FILE = path.resolve(REPO_ROOT, "src/lib/api-client/v1/openapi-types.gen.ts");
const SCRIPT = path.resolve(REPO_ROOT, "scripts/generate-v1-types.ts");

describe("openapi types drift", () => {
  it("generated file starts with AUTO-GENERATED header", () => {
    const content = readFileSync(GENERATED_FILE, "utf8");
    expect(content.startsWith("// AUTO-GENERATED")).toBe(true);
    expect(content).toContain("Run `bun run openapi:generate`");
  });

  it("generate-v1-types --check exits 0 (no drift)", () => {
    const result = spawnSync("bun", ["--conditions=react-server", SCRIPT, "--check"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    if (result.status !== 0) {
      // 输出诊断信息，方便排查
      // eslint-disable-next-line no-console
      console.error("stdout:", result.stdout);
      // eslint-disable-next-line no-console
      console.error("stderr:", result.stderr);
    }
    expect(result.status).toBe(0);
  }, 30_000);
});
