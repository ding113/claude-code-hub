/**
 * 从 /api/v1 OpenAPI 文档生成 TypeScript 类型。
 *
 * 行为：
 * - 在进程内导入 `@/app/api/v1/_root/app` 与 document 配置；
 * - 调用 `app.getOpenAPI31Document(managementApiDocumentConfig)` 拿到 OpenAPI 3.1 规范；
 * - 通过 `openapi-typescript` 的程序化 API（openapiTS + astToString）将规范转为 TS；
 * - 写入 `src/lib/api-client/v1/openapi-types.gen.ts`，文件首行附带 AUTO-GENERATED 头；
 * - 当传入 `--check` 时，写入临时文件并与已提交文件做 diff，检测到漂移则以非 0 退出。
 *
 * 使用方式：
 *   bun scripts/generate-v1-types.ts          # 重新生成并写入
 *   bun scripts/generate-v1-types.ts --check  # 漂移检测（CI 用）
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { managementApiApp } from "@/app/api/v1/_root/app";
import { managementApiDocumentConfig } from "@/app/api/v1/_root/document";
import openapiTS, { astToString } from "openapi-typescript";
import type { OpenAPI3 } from "openapi-typescript";

const PROJECT_ROOT = path.resolve(process.cwd());
const OUTPUT_FILE = path.resolve(
  PROJECT_ROOT,
  "src/lib/api-client/v1/openapi-types.gen.ts"
);

const HEADER =
  "// AUTO-GENERATED — DO NOT EDIT. Run `bun run openapi:generate` to refresh.\n";

interface GenerateOptions {
  /** 检查模式：仅检测漂移，不更新已提交文件 */
  check?: boolean;
}

async function buildTypeContent(): Promise<string> {
  const document = managementApiApp.getOpenAPI31Document(
    managementApiDocumentConfig
  ) as OpenAPI3;

  const ast = await openapiTS(document, {
    // 使用 OpenAPI 3.1，与 document.openapi === "3.1.0" 对齐
    enum: false,
    exportType: false,
  });

  const body = astToString(ast);
  return `${HEADER}\n${body}`;
}

async function ensureDir(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
}

async function writeIfDifferent(target: string, content: string): Promise<boolean> {
  let existing: string | null = null;
  try {
    existing = await readFile(target, "utf8");
  } catch {
    existing = null;
  }
  if (existing === content) {
    return false;
  }
  await ensureDir(target);
  await writeFile(target, content, "utf8");
  return true;
}

async function runCheck(content: string): Promise<number> {
  const dir = await mkdtemp(path.join(tmpdir(), "openapi-types-check-"));
  const tempFile = path.join(dir, "openapi-types.gen.ts");
  try {
    await writeFile(tempFile, content, "utf8");
    let committed: string;
    try {
      committed = await readFile(OUTPUT_FILE, "utf8");
    } catch {
      console.error(
        `[openapi:check] Generated file missing at ${OUTPUT_FILE}. Run \`bun run openapi:generate\`.`
      );
      return 1;
    }
    if (committed !== content) {
      console.error(
        `[openapi:check] Drift detected. Committed file at ${OUTPUT_FILE} differs from generated content.`
      );
      console.error(
        "[openapi:check] Run `bun run openapi:generate` to refresh and commit the result."
      );
      return 1;
    }
    return 0;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(opts: GenerateOptions): Promise<number> {
  const content = await buildTypeContent();

  if (opts.check) {
    return runCheck(content);
  }

  const updated = await writeIfDifferent(OUTPUT_FILE, content);
  if (updated) {
    console.log(`[openapi:generate] Wrote ${OUTPUT_FILE}`);
  } else {
    console.log(`[openapi:generate] No changes for ${OUTPUT_FILE}`);
  }
  return 0;
}

const argv = process.argv.slice(2);
const checkFlag = argv.includes("--check");

main({ check: checkFlag })
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    console.error("[generate-v1-types] Failed:", err);
    process.exit(1);
  });
