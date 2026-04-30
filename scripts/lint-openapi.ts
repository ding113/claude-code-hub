/**
 * OpenAPI 文档静态校验：保证每个操作都包含必需的元数据。
 *
 * 行为：
 * - 通过 `managementApiApp.getOpenAPI31Document(managementApiDocumentConfig)`
 *   实时生成 `/api/v1` 的 OpenAPI 3.1 规范；
 * - 遍历 `paths` 下的每个 operation，校验：
 *     - `summary` 非空（必填）；
 *     - `tags` 至少有一项（必填）；
 *     - `security` 必须存在且为数组（`Array.isArray`，必填）；
 *     - 至少一个成功响应（200 / 201 / 202 / 204，必填）；
 *     - `description` 非空（建议字段，缺失时仅警告，不会触发非零退出）。
 * - 任何「必填」字段缺失输出到 stderr，并以非零退出码结束；
 * - 仅 `description` 缺失时只打印 warning，不影响退出码；
 * - 全部通过则打印汇总并 0 退出。
 *
 * 使用：
 *   bun --conditions=react-server scripts/lint-openapi.ts
 *
 * 注意：本脚本只读元数据，不会启动 Next.js 服务器，也不会写文件。
 */

import { managementApiApp } from "@/app/api/v1/_root/app";
import { managementApiDocumentConfig } from "@/app/api/v1/_root/document";

/** OpenAPI 标准 HTTP 方法集合（路径项中可能出现的小写键） */
const HTTP_METHODS: readonly string[] = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

/** 视为「至少一个成功响应」的状态码集合 */
const SUCCESS_STATUS_CODES: readonly string[] = ["200", "201", "202", "204"];

/** 单个 operation 的违规记录；区分必填与建议级缺失 */
interface OperationViolation {
  /** 路径，如 `/api/v1/users` */
  path: string;
  /** HTTP 方法，统一大写 */
  method: string;
  /** 必填字段缺失（导致非零退出） */
  missingRequired: readonly string[];
  /** 建议字段缺失（仅 warning） */
  missingAdvisory: readonly string[];
}

/** 仅做最小结构判断的 operation 形状 */
interface OperationShape {
  summary?: unknown;
  description?: unknown;
  tags?: unknown;
  security?: unknown;
  responses?: Record<string, unknown>;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonEmptyTags(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasSecurityArray(value: unknown): boolean {
  return Array.isArray(value);
}

function hasSuccessResponse(responses: Record<string, unknown> | undefined): boolean {
  if (!responses) return false;
  return SUCCESS_STATUS_CODES.some((code) => Object.hasOwn(responses, code));
}

function validateOperation(
  path: string,
  method: string,
  operation: OperationShape
): OperationViolation | null {
  const missingRequired: string[] = [];
  const missingAdvisory: string[] = [];
  if (!isNonEmptyString(operation.summary)) missingRequired.push("summary");
  if (!hasNonEmptyTags(operation.tags)) missingRequired.push("tags");
  if (!hasSecurityArray(operation.security)) missingRequired.push("security");
  if (!hasSuccessResponse(operation.responses as Record<string, unknown> | undefined)) {
    missingRequired.push("responses[200|201|202|204]");
  }
  if (!isNonEmptyString(operation.description)) missingAdvisory.push("description");
  if (missingRequired.length === 0 && missingAdvisory.length === 0) return null;
  return {
    path,
    method: method.toUpperCase(),
    missingRequired,
    missingAdvisory,
  };
}

function collectViolations(): { violations: OperationViolation[]; total: number } {
  const document = managementApiApp.getOpenAPI31Document(managementApiDocumentConfig) as {
    paths?: Record<string, Record<string, unknown> | undefined>;
  };
  const paths = document.paths ?? {};

  const violations: OperationViolation[] = [];
  let total = 0;

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of HTTP_METHODS) {
      const operation = (pathItem as Record<string, unknown>)[method];
      if (!operation || typeof operation !== "object") continue;
      total += 1;
      const violation = validateOperation(path, method, operation as OperationShape);
      if (violation) violations.push(violation);
    }
  }
  return { violations, total };
}

function main(): number {
  const { violations, total } = collectViolations();

  // total === 0 视为失败：路由注册或文档构建异常导致 paths 为空时，原本会
  // 输出 "OK" 并 0 退出，从而绕过质量门禁。即便偶发为空也至少应该让 CI 报错。
  if (total === 0) {
    console.error("[openapi:lint] FAIL — no operations discovered from OpenAPI document.");
    return 1;
  }

  const requiredFailures = violations.filter((v) => v.missingRequired.length > 0);
  const advisoryOnly = violations.filter(
    (v) => v.missingRequired.length === 0 && v.missingAdvisory.length > 0
  );

  if (requiredFailures.length === 0) {
    console.log(
      `[openapi:lint] OK — ${total} operations validated; all required metadata present.`
    );
    if (advisoryOnly.length > 0) {
      console.log(
        `[openapi:lint] Advisory: ${advisoryOnly.length} operation(s) missing description (non-blocking):`
      );
      for (const v of advisoryOnly) {
        console.log(`  ${v.method} ${v.path} -> missing: ${v.missingAdvisory.join(", ")}`);
      }
    }
    return 0;
  }

  console.error(
    `[openapi:lint] FAIL — ${requiredFailures.length} of ${total} operations missing required metadata:`
  );
  for (const v of requiredFailures) {
    const parts: string[] = [];
    if (v.missingRequired.length > 0) parts.push(`required: ${v.missingRequired.join(", ")}`);
    if (v.missingAdvisory.length > 0) parts.push(`advisory: ${v.missingAdvisory.join(", ")}`);
    console.error(`  ${v.method} ${v.path} -> ${parts.join(" | ")}`);
  }
  return 1;
}

const code = main();
process.exit(code);
