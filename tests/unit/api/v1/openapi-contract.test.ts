/**
 * /api/v1 OpenAPI 文档契约校验。
 *
 * 通过 `scripts/lint-openapi.ts` 运行：每个 operation 必须包含
 *   summary / description / tags / security / 至少一个成功响应。
 *
 * 这里以 `spawnSync` 的形式调用脚本，与
 * `tests/unit/api/v1/openapi-types-drift.test.ts` 保持同样的隔离方式：
 * Vitest 进程内不直接 import 应用代码，避免引入 Next 服务端运行期依赖。
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SCRIPT = path.resolve(REPO_ROOT, "scripts/lint-openapi.ts");

describe("openapi metadata contract", () => {
  it("every operation has summary/description/tags/security/successResponse", () => {
    const result = spawnSync("bun", ["--conditions=react-server", SCRIPT], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    if (result.status !== 0) {
      // eslint-disable-next-line no-console
      console.error("stdout:", result.stdout);
      // eslint-disable-next-line no-console
      console.error("stderr:", result.stderr);
    }
    expect(result.status).toBe(0);
  }, 30_000);
});
