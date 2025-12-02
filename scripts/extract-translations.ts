#!/usr/bin/env tsx
/**
 * Translation String Extraction Script
 *
 * This script scans TSX files for hardcoded Chinese strings and extracts them
 * into translation JSON files with semantic keys.
 *
 * Usage:
 *   tsx scripts/extract-translations.ts [options]
 *
 * Options:
 *   --dry-run    Preview extraction without modifying files
 *   --verbose    Show detailed extraction process
 *   --target     Target directory to scan (default: src/app/[locale])
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Translation key naming convention: namespace.section.key
// Example: dashboard.stats.totalRequests, settings.providers.addButton

interface ExtractedString {
  original: string;
  key: string;
  file: string;
  line: number;
  context: string;
  namespace: string;
  needsReview: boolean;
}

interface ExtractionReport {
  totalFiles: number;
  totalStrings: number;
  extractedStrings: ExtractedString[];
  namespaceStats: Record<string, number>;
}

// Chinese character detection regex
const _CHINESE_REGEX = /[\u4e00-\u9fa5]+/g;

// Namespace mapping based on file path
const NAMESPACE_MAP: Record<string, string> = {
  "/login/": "auth",
  "/dashboard/": "dashboard",
  "/settings/": "settings",
  "/usage-doc/": "usage",
  "page.tsx": "common",
};

// Common Chinese phrases mapping
const PHRASE_MAP: Record<string, string> = {
  仪表盘: "dashboard",
  设置: "settings",
  用户: "users",
  供应商: "providers",
  模型: "models",
  请求: "requests",
  成本: "cost",
  统计: "stats",
  日志: "logs",
  配额: "quotas",
  会话: "sessions",
  密钥: "keys",
  价格: "prices",
  配置: "config",
  数据: "data",
  通知: "notifications",
  版本: "versions",
  敏感词: "sensitiveWords",
  登录: "login",
  退出: "logout",
  保存: "save",
  取消: "cancel",
  删除: "delete",
  编辑: "edit",
  添加: "add",
  刷新: "refresh",
  搜索: "search",
  导出: "export",
  导入: "import",
  确认: "confirm",
  提交: "submit",
  重置: "reset",
  查看: "view",
  复制: "copy",
  下载: "download",
  上传: "upload",
  启用: "enabled",
  禁用: "disabled",
  成功: "success",
  失败: "failed",
  错误: "error",
  警告: "warning",
  信息: "info",
  加载中: "loading",
  标题: "title",
  描述: "description",
  名称: "name",
  状态: "status",
  时间: "time",
  操作: "actions",
  详情: "details",
  列表: "list",
  表单: "form",
  按钮: "button",
  输入: "input",
  选择: "select",
  选项: "options",
  全部: "all",
  无: "none",
  是: "yes",
  否: "no",
  开: "on",
  关: "off",
};

/**
 * Determine namespace from file path
 */
function getNamespace(filePath: string): string {
  for (const [pattern, namespace] of Object.entries(NAMESPACE_MAP)) {
    if (filePath.includes(pattern)) {
      return namespace;
    }
  }
  return "common";
}

/**
 * Generate semantic key from Chinese string
 */
function generateKey(
  chineseText: string,
  namespace: string,
  context: string
): { key: string; needsReview: boolean } {
  // Check if it's a common phrase
  const mapped = PHRASE_MAP[chineseText];
  if (mapped) {
    return { key: `${namespace}.${mapped}`, needsReview: false };
  }

  // Try to infer section from context
  let section = "misc";
  const contextLower = context.toLowerCase();

  if (contextLower.includes("title")) section = "title";
  else if (contextLower.includes("description")) section = "description";
  else if (contextLower.includes("button") || contextLower.includes("btn")) section = "actions";
  else if (contextLower.includes("label")) section = "labels";
  else if (contextLower.includes("placeholder")) section = "placeholders";
  else if (contextLower.includes("error")) section = "errors";
  else if (contextLower.includes("toast")) section = "toasts";
  else if (contextLower.includes("dialog")) section = "dialogs";

  // Generate a safe key from Chinese text
  const safeKey = chineseText
    .substring(0, 30)
    .replace(/[^\u4e00-\u9fa5]/g, "")
    .substring(0, 10);

  // Use Pinyin-like mapping for key (simplified)
  const keyPart = Array.from(safeKey)
    .map((_char, i) => `key${i}`)
    .join("");

  return {
    key: `${namespace}.${section}.${keyPart || "text"}`,
    needsReview: true, // Manual review needed for auto-generated keys
  };
}

/**
 * Extract Chinese strings from a file
 */
function extractFromFile(filePath: string): ExtractedString[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const extracted: ExtractedString[] = [];
  const namespace = getNamespace(filePath);

  // Simple regex-based extraction
  // This is a simplified version - a full AST parser would be more robust
  lines.forEach((line, lineIndex) => {
    // Skip imports, comments
    if (
      line.trim().startsWith("import ") ||
      line.trim().startsWith("//") ||
      line.trim().startsWith("/*")
    ) {
      return;
    }

    // Find all Chinese strings
    const matches = line.matchAll(/["'`]([^"'`]*[\u4e00-\u9fa5]+[^"'`]*)["'`]/g);
    for (const match of matches) {
      const original = match[1];
      if (!original || original.length < 2) continue;

      // Get surrounding context (30 chars before and after)
      const matchIndex = line.indexOf(match[0]);
      const contextStart = Math.max(0, matchIndex - 30);
      const contextEnd = Math.min(line.length, matchIndex + match[0].length + 30);
      const context = line.substring(contextStart, contextEnd).trim();

      const { key, needsReview } = generateKey(original, namespace, context);

      extracted.push({
        original,
        key,
        file: filePath,
        line: lineIndex + 1,
        context,
        namespace,
        needsReview,
      });
    }
  });

  return extracted;
}

/**
 * Group extracted strings by namespace
 */
function groupByNamespace(strings: ExtractedString[]): Record<string, ExtractedString[]> {
  const grouped: Record<string, ExtractedString[]> = {};
  for (const str of strings) {
    if (!grouped[str.namespace]) {
      grouped[str.namespace] = [];
    }
    grouped[str.namespace].push(str);
  }
  return grouped;
}

/**
 * Generate translation JSON files
 */
function generateTranslationFiles(strings: ExtractedString[], dryRun: boolean): void {
  const grouped = groupByNamespace(strings);

  for (const [namespace, items] of Object.entries(grouped)) {
    const translationFile = path.join(process.cwd(), `messages/zh-CN/${namespace}.json`);

    // Read existing translations
    let translations: any = {};
    if (fs.existsSync(translationFile)) {
      translations = JSON.parse(fs.readFileSync(translationFile, "utf-8"));
    }

    // Add new translations (preserving existing structure)
    for (const item of items) {
      const keyParts = item.key.replace(`${namespace}.`, "").split(".");
      let current = translations;

      for (let i = 0; i < keyParts.length - 1; i++) {
        const part = keyParts[i];
        if (!current[part] || typeof current[part] !== "object") {
          current[part] = {};
        }
        current = current[part];
      }

      const finalKey = keyParts[keyParts.length - 1];
      // Only add if key doesn't exist or is not an object (avoid overwriting nested objects)
      if (!current[finalKey]) {
        current[finalKey] = item.original;
      }
    }

    if (!dryRun) {
      fs.writeFileSync(translationFile, `${JSON.stringify(translations, null, 2)}\n`, "utf-8");
      console.log(`✓ Updated ${namespace}.json with ${items.length} strings`);
    } else {
      console.log(`[DRY RUN] Would update ${namespace}.json with ${items.length} strings`);
    }
  }
}

/**
 * Generate extraction report
 */
function generateReport(strings: ExtractedString[]): ExtractionReport {
  const namespaceStats: Record<string, number> = {};
  const files = new Set<string>();

  for (const str of strings) {
    files.add(str.file);
    namespaceStats[str.namespace] = (namespaceStats[str.namespace] || 0) + 1;
  }

  return {
    totalFiles: files.size,
    totalStrings: strings.length,
    extractedStrings: strings,
    namespaceStats,
  };
}

/**
 * Find all page.tsx files recursively
 */
function findPageFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
        files.push(...findPageFiles(fullPath));
      }
    } else if (entry.name === "page.tsx") {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Main extraction process
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const verbose = args.includes("--verbose");
  const targetIdx = args.indexOf("--target");
  const targetDir = targetIdx >= 0 ? args[targetIdx + 1] : "src/app/[locale]";

  console.log("🔍 Translation String Extraction");
  console.log("================================\n");

  // Find all page.tsx files
  const files = findPageFiles(path.join(process.cwd(), targetDir));
  console.log(`Found ${files.length} files to scan\n`);

  // Extract strings from all files
  const allStrings: ExtractedString[] = [];
  for (const file of files) {
    const extracted = extractFromFile(file);
    allStrings.push(...extracted);
    if (verbose && extracted.length > 0) {
      console.log(`📄 ${path.relative(process.cwd(), file)}: ${extracted.length} strings`);
    }
  }

  // Generate report
  const report = generateReport(allStrings);
  console.log("\n📊 Extraction Report");
  console.log("-------------------");
  console.log(`Total files scanned: ${report.totalFiles}`);
  console.log(`Total strings found: ${report.totalStrings}`);
  console.log(`\nNamespace breakdown:`);
  for (const [ns, count] of Object.entries(report.namespaceStats)) {
    console.log(`  ${ns}: ${count} strings`);
  }

  // Show strings needing review
  const needsReview = allStrings.filter((s) => s.needsReview);
  if (needsReview.length > 0) {
    console.log(`\n⚠️  ${needsReview.length} strings need manual review`);
    if (verbose) {
      console.log("\nStrings needing review:");
      needsReview.slice(0, 10).forEach((s) => {
        console.log(`  ${s.key}: "${s.original}" (${path.basename(s.file)}:${s.line})`);
      });
      if (needsReview.length > 10) {
        console.log(`  ... and ${needsReview.length - 10} more`);
      }
    }
  }

  // Generate translation files
  console.log("\n📝 Generating translation files...");
  generateTranslationFiles(allStrings, dryRun);

  console.log("\nExtraction complete!");
  if (dryRun) {
    console.log("   (Run without --dry-run to save changes)");
  }
}

main().catch(console.error);
