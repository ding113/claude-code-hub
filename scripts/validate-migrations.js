#!/usr/bin/env node

/**
 * 迁移文件幂等性校验脚本
 *
 * 检查所有 Drizzle 迁移文件，确保：
 * 1. CREATE TABLE 使用 IF NOT EXISTS
 * 2. CREATE INDEX 使用 IF NOT EXISTS
 *
 * 防止迁移在重复执行或数据库状态不一致时失败
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 迁移文件目录
const MIGRATIONS_DIR = path.join(__dirname, "../drizzle");

// 豁免列表：历史迁移文件（在问题修复前已发布的版本）
// 这些文件虽然缺少 IF NOT EXISTS，但已在生产环境稳定运行
// 不建议修改以避免引入新问题
const EXEMPT_FILES = [
  "0000_legal_brother_voodoo.sql", // 初始迁移
  "0001_ambiguous_bromley.sql", // 历史迁移
  "0002_fancy_preak.sql", // 历史迁移
  "0003_outstanding_centennial.sql", // 历史迁移
  "0004_dazzling_starbolt.sql", // 历史迁移
  "0005_true_raza.sql", // 历史迁移
  "0006_lame_matthew_murdock.sql", // 历史迁移
  "0007_lazy_post.sql", // 历史迁移
  "0008_talented_molten_man.sql", // 历史迁移
  "0009_many_amazoness.sql", // 历史迁移
  "0010_unusual_bloodscream.sql", // 历史迁移
  "0011_charming_ben_parker.sql", // 历史迁移
  "0012_elite_iron_patriot.sql", // 历史迁移
  "0014_overconfident_mongu.sql", // 历史迁移（0013 已修复）
];

// 颜色输出
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

function log(color, prefix, message) {
  console.log(`${color}${prefix}${colors.reset} ${message}`);
}

function info(message) {
  log(colors.blue, "[INFO]", message);
}

function warn(message) {
  log(colors.yellow, "[WARN]", message);
}

function error(message) {
  log(colors.red, "[ERROR]", message);
}

function success(message) {
  log(colors.green, "[SUCCESS]", message);
}

/**
 * 检查 SQL 文件的幂等性
 */
function validateMigrationFile(filePath) {
  const fileName = path.basename(filePath);
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const issues = [];

  // 检查 CREATE TABLE 语句
  const createTableRegex = /CREATE\s+TABLE\s+"[^"]+"/gi;
  const createTableIfNotExistsRegex = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"[^"]+"/gi;

  const createTables = content.match(createTableRegex) || [];
  const createTablesIfNotExists = content.match(createTableIfNotExistsRegex) || [];

  const missingIfNotExistsTables = createTables.length - createTablesIfNotExists.length;

  if (missingIfNotExistsTables > 0) {
    createTables.forEach((match) => {
      if (!/IF\s+NOT\s+EXISTS/i.test(match)) {
        const lineNumber = lines.findIndex((line) => line.includes(match.split('"')[1])) + 1;
        issues.push({
          type: "CREATE TABLE",
          line: lineNumber,
          statement: match,
          suggestion: match.replace(/CREATE\s+TABLE\s+/i, "CREATE TABLE IF NOT EXISTS "),
        });
      }
    });
  }

  // 检查 CREATE INDEX 语句
  const createIndexRegex = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+"[^"]+"/gi;
  const createIndexIfNotExistsRegex =
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+"[^"]+"/gi;

  const createIndexes = content.match(createIndexRegex) || [];
  const createIndexesIfNotExists = content.match(createIndexIfNotExistsRegex) || [];

  const missingIfNotExistsIndexes = createIndexes.length - createIndexesIfNotExists.length;

  if (missingIfNotExistsIndexes > 0) {
    createIndexes.forEach((match) => {
      if (!/IF\s+NOT\s+EXISTS/i.test(match)) {
        const lineNumber = lines.findIndex((line) => line.includes(match)) + 1;
        issues.push({
          type: "CREATE INDEX",
          line: lineNumber,
          statement: match,
          suggestion: match.replace(
            /CREATE\s+(UNIQUE\s+)?INDEX\s+/i,
            "CREATE $1INDEX IF NOT EXISTS "
          ),
        });
      }
    });
  }

  return { fileName, issues };
}

/**
 * 主函数
 */
function main() {
  info("开始检查迁移文件的幂等性...\n");

  // 获取所有 .sql 迁移文件
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql") && /^\d{4}_/.test(file))
    .sort()
    .map((file) => path.join(MIGRATIONS_DIR, file));

  if (files.length === 0) {
    warn("未找到任何迁移文件");
    process.exit(0);
  }

  info(`找到 ${files.length} 个迁移文件\n`);

  let totalIssues = 0;
  const filesWithIssues = [];

  // 检查每个文件
  files.forEach((filePath) => {
    const result = validateMigrationFile(filePath);
    const isExempt = EXEMPT_FILES.includes(result.fileName);

    if (result.issues.length > 0) {
      if (isExempt) {
        // 豁免文件：只显示警告，不计入失败
        warn(`${result.fileName} - 发现 ${result.issues.length} 个问题（已豁免）`);
        return;
      }

      totalIssues += result.issues.length;
      filesWithIssues.push(result);

      error(`${result.fileName} - 发现 ${result.issues.length} 个问题:`);
      result.issues.forEach((issue, index) => {
        console.log(`\n  ${index + 1}. ${issue.type} (第 ${issue.line} 行)`);
        console.log(`     ${colors.red}✗${colors.reset} ${issue.statement}`);
        console.log(`     ${colors.green}✓${colors.reset} ${issue.suggestion}`);
      });
      console.log("");
    }
  });

  // 输出总结
  console.log("─".repeat(60));
  if (totalIssues === 0) {
    success(`所有 ${files.length} 个迁移文件都通过了幂等性检查 ✓`);
    process.exit(0);
  } else {
    error(`检查完成: 发现 ${totalIssues} 个问题，涉及 ${filesWithIssues.length} 个文件`);
    console.log("");
    warn("建议修复上述问题以确保迁移的幂等性");
    warn("所有 CREATE TABLE 和 CREATE INDEX 语句都应该使用 IF NOT EXISTS");
    process.exit(1);
  }
}

// 执行
try {
  main();
} catch (err) {
  error(`脚本执行失败: ${err.message}`);
  console.error(err);
  process.exit(1);
}
