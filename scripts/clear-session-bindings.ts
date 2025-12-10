#!/usr/bin/env bun

/**
 * 清除指定供应商的会话绑定
 *
 * 用法:
 *   # 交互式模式（推荐）
 *   bun run scripts/clear-session-bindings.ts
 *
 *   # 按优先级筛选
 *   bun run scripts/clear-session-bindings.ts --priority <number>
 *
 *   # 指定供应商 ID
 *   bun run scripts/clear-session-bindings.ts --id 1,2,3
 *
 *   # 指定供应商名称（模糊匹配）
 *   bun run scripts/clear-session-bindings.ts --name "cubence"
 *
 * 选项:
 *   --priority, -p <number>  优先级阈值（清除 priority < 该值的供应商绑定）
 *   --id <ids>               指定供应商 ID（逗号分隔）
 *   --name <pattern>         按名称模糊匹配供应商
 *   --type <type>            供应商类型筛选（claude, claude-auth, codex, 默认全部）
 *   --yes, -y                跳过确认提示
 *   --dry-run                仅显示将要清理的内容，不实际执行
 *   --help, -h               显示帮助信息
 */

import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { and, asc, eq, ilike, inArray, isNull, lt, or } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import Redis, { type RedisOptions } from "ioredis";
import postgres from "postgres";

import * as schema from "../src/drizzle/schema";

// ============================================================================
// 常量配置
// ============================================================================

const SCAN_BATCH_SIZE = 500;
const PIPELINE_BATCH_SIZE = 200;

// Session 相关的 Redis Key 后缀
const SESSION_KEY_SUFFIXES = [
  "provider",
  "info",
  "usage",
  "key",
  "last_seen",
  "messages",
  "response",
  "concurrent_count",
];

// ============================================================================
// 类型定义
// ============================================================================

type Database = PostgresJsDatabase<typeof schema>;
type PostgresClient = ReturnType<typeof postgres>;
type ProviderType =
  | "claude"
  | "claude-auth"
  | "codex"
  | "gemini-cli"
  | "gemini"
  | "openai-compatible";

const VALID_PROVIDER_TYPES: ReadonlyArray<ProviderType | "all"> = [
  "claude",
  "claude-auth",
  "codex",
  "gemini-cli",
  "gemini",
  "openai-compatible",
  "all",
];

function isValidProviderType(value: string): value is ProviderType | "all" {
  return VALID_PROVIDER_TYPES.includes(value as ProviderType | "all");
}

interface ProviderRecord {
  id: number;
  name: string;
  priority: number;
  providerType: string;
  isEnabled: boolean;
}

interface SessionBinding {
  providerId: number;
  keyId?: number | null;
}

interface CliOptions {
  mode: "interactive" | "priority" | "id" | "name";
  priorityThreshold?: number;
  providerIds?: number[];
  namePattern?: string;
  providerType?: ProviderType | "all";
  assumeYes: boolean;
  dryRun: boolean;
}

interface CleanupResult {
  sessionCount: number;
  deletedKeys: number;
  zsetRemovals: number;
  missingKeyRefs: number;
}

// ============================================================================
// CLI 参数解析
// ============================================================================

function printUsage(): void {
  console.log(`
用法: bun run scripts/clear-session-bindings.ts [选项]

清除指定供应商的会话绑定。支持交互式选择或通过参数指定。

模式选择（互斥，不指定则进入交互模式）:
  --priority, -p <number>  按优先级筛选（清除 priority < 该值的供应商）
  --id <ids>               指定供应商 ID（逗号分隔，如 1,2,3）
  --name <pattern>         按名称模糊匹配供应商

筛选选项:
  --type <type>            供应商类型筛选（claude, claude-auth, codex, all）
                           默认: all

执行选项:
  --yes, -y                跳过确认提示，直接执行
  --dry-run                仅显示将要清理的内容，不实际执行删除操作
  --help, -h               显示此帮助信息

示例:
  # 交互式模式（推荐新手使用）
  bun run scripts/clear-session-bindings.ts

  # 清除优先级小于 10 的 Claude 供应商
  bun run scripts/clear-session-bindings.ts --priority 10 --type claude

  # 清除指定 ID 的供应商绑定
  bun run scripts/clear-session-bindings.ts --id 1,2,3

  # 按名称模糊匹配
  bun run scripts/clear-session-bindings.ts --name "cubence"

  # 预览模式
  bun run scripts/clear-session-bindings.ts --priority 5 --dry-run
`);
}

function parseCliArgs(args: string[]): CliOptions {
  let priorityValue: number | null = null;
  let providerIds: number[] | null = null;
  let namePattern: string | null = null;
  let providerType: ProviderType | "all" | undefined;
  let assumeYes = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--priority" || arg === "-p") {
      const nextValue = args[++i];
      if (!nextValue) throw new Error("--priority 需要一个数值参数");
      priorityValue = Number.parseInt(nextValue, 10);
      if (Number.isNaN(priorityValue)) throw new Error("--priority 必须是整数");
    } else if (arg.startsWith("--priority=")) {
      priorityValue = Number.parseInt(arg.split("=")[1], 10);
      if (Number.isNaN(priorityValue)) throw new Error("--priority 必须是整数");
    } else if (arg === "--id") {
      const nextValue = args[++i];
      if (!nextValue) throw new Error("--id 需要供应商 ID 列表");
      providerIds = nextValue.split(",").map((s) => {
        const id = Number.parseInt(s.trim(), 10);
        if (Number.isNaN(id)) throw new Error(`无效的供应商 ID: ${s}`);
        return id;
      });
    } else if (arg.startsWith("--id=")) {
      providerIds = arg
        .split("=")[1]
        .split(",")
        .map((s) => {
          const id = Number.parseInt(s.trim(), 10);
          if (Number.isNaN(id)) throw new Error(`无效的供应商 ID: ${s}`);
          return id;
        });
    } else if (arg === "--name") {
      namePattern = args[++i];
      if (!namePattern) throw new Error("--name 需要一个匹配模式");
    } else if (arg.startsWith("--name=")) {
      namePattern = arg.split("=")[1];
    } else if (arg === "--type") {
      const typeValue = args[++i];
      if (!typeValue || !isValidProviderType(typeValue)) {
        throw new Error(
          `无效的供应商类型: ${typeValue}。有效值: ${VALID_PROVIDER_TYPES.join(", ")}`
        );
      }
      providerType = typeValue;
    } else if (arg.startsWith("--type=")) {
      const typeValue = arg.split("=")[1];
      if (!isValidProviderType(typeValue)) {
        throw new Error(
          `无效的供应商类型: ${typeValue}。有效值: ${VALID_PROVIDER_TYPES.join(", ")}`
        );
      }
      providerType = typeValue;
    } else if (arg === "--yes" || arg === "-y") {
      assumeYes = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  // 确定模式
  const modeCount = [priorityValue !== null, providerIds !== null, namePattern !== null].filter(
    Boolean
  ).length;
  if (modeCount > 1) {
    throw new Error("--priority, --id, --name 不能同时使用，请选择一种筛选方式");
  }

  let mode: CliOptions["mode"] = "interactive";
  if (priorityValue !== null) mode = "priority";
  else if (providerIds !== null) mode = "id";
  else if (namePattern !== null) mode = "name";

  return {
    mode,
    priorityThreshold: priorityValue ?? undefined,
    providerIds: providerIds ?? undefined,
    namePattern: namePattern ?? undefined,
    providerType,
    assumeYes,
    dryRun,
  };
}

// ============================================================================
// 数据库和 Redis 连接
// ============================================================================

function createDatabaseConnection(connectionString: string): {
  client: PostgresClient;
  db: Database;
} {
  const client = postgres(connectionString);
  const db = drizzle(client, { schema });
  return { client, db };
}

async function createRedisClient(redisUrl: string): Promise<Redis> {
  const options: RedisOptions = {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) {
        console.error("[Redis] 重试次数已达上限，放弃连接");
        return null;
      }
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  };

  if (redisUrl.startsWith("rediss://")) {
    try {
      const url = new URL(redisUrl);
      options.tls = { host: url.hostname };
    } catch {
      options.tls = {};
    }
  }

  const redis = new Redis(redisUrl, options);

  // 等待连接就绪
  await redis.connect();

  return redis;
}

async function safeCloseRedis(redis: Redis | null): Promise<void> {
  if (!redis) return;
  try {
    await redis.quit();
  } catch (error) {
    console.warn("关闭 Redis 连接时发生错误:", error);
  }
}

async function safeClosePostgres(client: PostgresClient | null): Promise<void> {
  if (!client) return;
  try {
    await client.end({ timeout: 5 });
  } catch (error) {
    console.warn("关闭数据库连接时发生错误:", error);
  }
}

// ============================================================================
// 数据库查询
// ============================================================================

async function fetchAllProviders(db: Database): Promise<ProviderRecord[]> {
  const rows = await db
    .select({
      id: schema.providers.id,
      name: schema.providers.name,
      priority: schema.providers.priority,
      providerType: schema.providers.providerType,
      isEnabled: schema.providers.isEnabled,
    })
    .from(schema.providers)
    .where(isNull(schema.providers.deletedAt))
    .orderBy(asc(schema.providers.priority), asc(schema.providers.id));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    priority: row.priority ?? 0,
    providerType: row.providerType,
    isEnabled: row.isEnabled,
  }));
}

async function fetchProvidersByPriority(
  db: Database,
  threshold: number,
  providerType?: ProviderType | "all"
): Promise<ProviderRecord[]> {
  const conditions = [isNull(schema.providers.deletedAt), lt(schema.providers.priority, threshold)];

  if (providerType && providerType !== "all") {
    if (providerType === "claude") {
      conditions.push(
        or(
          eq(schema.providers.providerType, "claude"),
          eq(schema.providers.providerType, "claude-auth")
        )!
      );
    } else {
      conditions.push(eq(schema.providers.providerType, providerType));
    }
  }

  const rows = await db
    .select({
      id: schema.providers.id,
      name: schema.providers.name,
      priority: schema.providers.priority,
      providerType: schema.providers.providerType,
      isEnabled: schema.providers.isEnabled,
    })
    .from(schema.providers)
    .where(and(...conditions))
    .orderBy(asc(schema.providers.priority), asc(schema.providers.id));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    priority: row.priority ?? 0,
    providerType: row.providerType,
    isEnabled: row.isEnabled,
  }));
}

async function fetchProvidersByIds(db: Database, ids: number[]): Promise<ProviderRecord[]> {
  const rows = await db
    .select({
      id: schema.providers.id,
      name: schema.providers.name,
      priority: schema.providers.priority,
      providerType: schema.providers.providerType,
      isEnabled: schema.providers.isEnabled,
    })
    .from(schema.providers)
    .where(and(isNull(schema.providers.deletedAt), inArray(schema.providers.id, ids)))
    .orderBy(asc(schema.providers.priority), asc(schema.providers.id));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    priority: row.priority ?? 0,
    providerType: row.providerType,
    isEnabled: row.isEnabled,
  }));
}

async function fetchProvidersByName(db: Database, pattern: string): Promise<ProviderRecord[]> {
  const rows = await db
    .select({
      id: schema.providers.id,
      name: schema.providers.name,
      priority: schema.providers.priority,
      providerType: schema.providers.providerType,
      isEnabled: schema.providers.isEnabled,
    })
    .from(schema.providers)
    .where(and(isNull(schema.providers.deletedAt), ilike(schema.providers.name, `%${pattern}%`)))
    .orderBy(asc(schema.providers.priority), asc(schema.providers.id));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    priority: row.priority ?? 0,
    providerType: row.providerType,
    isEnabled: row.isEnabled,
  }));
}

// ============================================================================
// Redis 操作
// ============================================================================

function extractSessionIdFromKey(redisKey: string): string | null {
  const match = /^session:(.+):provider$/.exec(redisKey);
  return match ? match[1] : null;
}

async function findSessionsBoundToProviders(
  redis: Redis,
  providerIds: Set<number>
): Promise<Map<string, SessionBinding>> {
  const sessionMap = new Map<string, SessionBinding>();

  if (providerIds.size === 0) return sessionMap;

  let cursor = "0";
  let scannedKeys = 0;

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      "session:*:provider",
      "COUNT",
      SCAN_BATCH_SIZE
    );
    cursor = nextCursor;

    if (!keys || keys.length === 0) continue;

    scannedKeys += keys.length;

    const pipeline = redis.pipeline();
    for (const key of keys) {
      pipeline.get(key);
    }

    const results = await pipeline.exec();

    keys.forEach((key, index) => {
      const result = results?.[index];
      if (!result) return;

      const [error, value] = result;
      if (error || typeof value !== "string") return;

      const providerId = Number.parseInt(value, 10);
      if (!Number.isFinite(providerId) || !providerIds.has(providerId)) return;

      const sessionId = extractSessionIdFromKey(key);
      if (!sessionId) return;

      sessionMap.set(sessionId, { providerId });
    });
  } while (cursor !== "0");

  console.log(`  扫描了 ${scannedKeys} 个 session:*:provider key`);

  return sessionMap;
}

async function populateSessionKeyBindings(
  redis: Redis,
  sessionMap: Map<string, SessionBinding>
): Promise<void> {
  if (sessionMap.size === 0) return;

  const sessionIds = Array.from(sessionMap.keys());

  // 第一轮：尝试从 session:${sessionId}:key 获取
  for (let i = 0; i < sessionIds.length; i += PIPELINE_BATCH_SIZE) {
    const chunk = sessionIds.slice(i, i + PIPELINE_BATCH_SIZE);
    const pipeline = redis.pipeline();

    for (const sessionId of chunk) {
      pipeline.get(`session:${sessionId}:key`);
    }

    const results = await pipeline.exec();

    chunk.forEach((sessionId, index) => {
      const result = results?.[index];
      if (!result) return;

      const [error, value] = result;
      if (error || typeof value !== "string") return;

      const keyId = Number.parseInt(value, 10);
      if (Number.isFinite(keyId)) {
        const binding = sessionMap.get(sessionId);
        if (binding) binding.keyId = keyId;
      }
    });
  }

  // 第二轮：从 info hash 补充缺失的 keyId
  const missingKeyIds = sessionIds.filter((id) => sessionMap.get(id)?.keyId == null);

  if (missingKeyIds.length === 0) return;

  console.log(`  ${missingKeyIds.length} 个 session 缺少 key 绑定，尝试从 info hash 获取...`);

  for (let i = 0; i < missingKeyIds.length; i += PIPELINE_BATCH_SIZE) {
    const chunk = missingKeyIds.slice(i, i + PIPELINE_BATCH_SIZE);
    const pipeline = redis.pipeline();

    for (const sessionId of chunk) {
      pipeline.hget(`session:${sessionId}:info`, "keyId");
    }

    const results = await pipeline.exec();

    chunk.forEach((sessionId, index) => {
      const result = results?.[index];
      if (!result) return;

      const [error, value] = result;
      if (error || typeof value !== "string") return;

      const keyId = Number.parseInt(value, 10);
      if (Number.isFinite(keyId)) {
        const binding = sessionMap.get(sessionId);
        if (binding) binding.keyId = keyId;
      }
    });
  }
}

async function clearSessionBindings(
  redis: Redis,
  sessionMap: Map<string, SessionBinding>,
  dryRun: boolean
): Promise<CleanupResult> {
  const entries = Array.from(sessionMap.entries());
  let deletedKeys = 0;
  let zsetRemovals = 0;
  let missingKeyRefs = 0;

  if (dryRun) {
    for (const [, binding] of entries) {
      deletedKeys += SESSION_KEY_SUFFIXES.length;
      zsetRemovals += 2;
      if (binding.keyId != null) zsetRemovals += 1;
      else missingKeyRefs += 1;
    }

    return { sessionCount: entries.length, deletedKeys, zsetRemovals, missingKeyRefs };
  }

  for (let i = 0; i < entries.length; i += PIPELINE_BATCH_SIZE) {
    const chunk = entries.slice(i, i + PIPELINE_BATCH_SIZE);
    const pipeline = redis.pipeline();
    const commandTypes: Array<"del" | "zrem"> = [];

    for (const [sessionId, binding] of chunk) {
      const keysToDelete = SESSION_KEY_SUFFIXES.map((suffix) => `session:${sessionId}:${suffix}`);
      pipeline.del(...keysToDelete);
      commandTypes.push("del");

      pipeline.zrem("global:active_sessions", sessionId);
      commandTypes.push("zrem");

      pipeline.zrem(`provider:${binding.providerId}:active_sessions`, sessionId);
      commandTypes.push("zrem");

      if (binding.keyId != null) {
        pipeline.zrem(`key:${binding.keyId}:active_sessions`, sessionId);
        commandTypes.push("zrem");
      } else {
        missingKeyRefs += 1;
      }
    }

    const results = await pipeline.exec();

    results?.forEach(([error, value], index) => {
      if (error) return;
      const type = commandTypes[index];
      if (type === "del" && typeof value === "number") deletedKeys += value;
      else if (type === "zrem" && typeof value === "number") zsetRemovals += value;
    });

    const processed = Math.min(i + PIPELINE_BATCH_SIZE, entries.length);
    process.stdout.write(`\r  清理进度: ${processed}/${entries.length}`);
  }

  console.log();

  return { sessionCount: entries.length, deletedKeys, zsetRemovals, missingKeyRefs };
}

// ============================================================================
// 交互式界面
// ============================================================================

class InteractiveMenu {
  private rl: ReadlineInterface;

  constructor() {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => resolve(answer.trim()));
    });
  }

  close(): void {
    this.rl.close();
  }

  displayProviderList(providers: ProviderRecord[]): void {
    console.log("\n可用供应商列表：\n");
    console.log("  序号  ID    名称                          优先级  类型           状态");
    console.log(`  ${"-".repeat(75)}`);

    providers.forEach((p, index) => {
      const status = p.isEnabled ? "启用" : "禁用";
      const name = p.name.length > 28 ? `${p.name.substring(0, 25)}...` : p.name.padEnd(28);
      console.log(
        `  ${String(index + 1).padStart(4)}  ${String(p.id).padStart(4)}  ${name}  ${String(p.priority).padStart(6)}  ${p.providerType.padEnd(13)}  ${status}`
      );
    });
    console.log();
  }

  async selectProviders(providers: ProviderRecord[]): Promise<ProviderRecord[]> {
    this.displayProviderList(providers);

    console.log("选择方式：");
    console.log("  - 输入序号（逗号分隔）: 1,2,3");
    console.log("  - 输入范围: 1-5");
    console.log("  - 输入 'all' 选择全部");
    console.log("  - 输入 'q' 退出\n");

    const input = await this.question("请选择要清理的供应商: ");

    if (input.toLowerCase() === "q") {
      return [];
    }

    if (input.toLowerCase() === "all") {
      return providers;
    }

    const selectedIndices = new Set<number>();

    // 解析输入
    const parts = input.split(",").map((s) => s.trim());
    for (const part of parts) {
      if (part.includes("-")) {
        const [start, end] = part.split("-").map((s) => Number.parseInt(s.trim(), 10));
        if (!Number.isNaN(start) && !Number.isNaN(end)) {
          for (let i = start; i <= end; i++) {
            if (i >= 1 && i <= providers.length) {
              selectedIndices.add(i - 1);
            }
          }
        }
      } else {
        const index = Number.parseInt(part, 10);
        if (!Number.isNaN(index) && index >= 1 && index <= providers.length) {
          selectedIndices.add(index - 1);
        }
      }
    }

    return Array.from(selectedIndices)
      .sort((a, b) => a - b)
      .map((i) => providers[i]);
  }

  async confirm(message: string): Promise<boolean> {
    const answer = await this.question(`${message} [y/N]: `);
    return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
  }

  async selectMainAction(): Promise<"priority" | "select" | "type" | "name" | "quit"> {
    console.log("\n请选择操作：");
    console.log("  1. 按优先级筛选");
    console.log("  2. 手动选择供应商");
    console.log("  3. 按类型筛选");
    console.log("  4. 按名称搜索");
    console.log("  q. 退出\n");

    const input = await this.question("请输入选项: ");

    switch (input.toLowerCase()) {
      case "1":
        return "priority";
      case "2":
        return "select";
      case "3":
        return "type";
      case "4":
        return "name";
      case "q":
      case "quit":
      case "exit":
        return "quit";
      default:
        console.log("无效选项，请重新输入");
        return this.selectMainAction();
    }
  }

  async selectProviderType(providers: ProviderRecord[]): Promise<string | null> {
    // 统计每种类型的数量
    const typeCounts = new Map<string, number>();
    for (const p of providers) {
      typeCounts.set(p.providerType, (typeCounts.get(p.providerType) || 0) + 1);
    }

    const types = Array.from(typeCounts.keys()).sort();

    console.log("\n可用的供应商类型：\n");
    types.forEach((type, index) => {
      console.log(`  ${index + 1}. ${type} (${typeCounts.get(type)} 个)`);
    });
    console.log(`  a. 全部类型`);
    console.log(`  q. 返回上级菜单\n`);

    const input = await this.question("请选择类型: ");

    if (input.toLowerCase() === "q") {
      return null;
    }

    if (input.toLowerCase() === "a" || input.toLowerCase() === "all") {
      return "all";
    }

    const index = Number.parseInt(input, 10);
    if (!Number.isNaN(index) && index >= 1 && index <= types.length) {
      return types[index - 1];
    }

    // 也支持直接输入类型名称
    if (types.includes(input)) {
      return input;
    }

    console.log("无效选项，请重新输入");
    return this.selectProviderType(providers);
  }

  async inputPriority(): Promise<number | null> {
    const input = await this.question("请输入优先级阈值（清除 priority < 该值的供应商）: ");
    const value = Number.parseInt(input, 10);
    if (Number.isNaN(value)) {
      console.log("无效的数字，请重新输入");
      return this.inputPriority();
    }
    return value;
  }

  async inputNamePattern(): Promise<string | null> {
    const input = await this.question("请输入供应商名称（模糊匹配）: ");
    return input || null;
  }
}

// ============================================================================
// 主流程
// ============================================================================

function displaySelectedProviders(providers: ProviderRecord[]): void {
  console.log(`\n已选择 ${providers.length} 个供应商：\n`);
  console.table(
    providers.map((p) => ({
      ID: p.id,
      名称: p.name,
      优先级: p.priority,
      类型: p.providerType,
      状态: p.isEnabled ? "启用" : "禁用",
    }))
  );
}

function displayResult(result: CleanupResult, dryRun: boolean): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(dryRun ? "  Dry-Run 结果摘要" : "  清理完成");
  console.log("=".repeat(60));
  console.log(`  Session 数量:     ${result.sessionCount}`);
  console.log(`  删除的 Key 数量:  ${result.deletedKeys}`);
  console.log(`  ZSET 移除数量:    ${result.zsetRemovals}`);

  if (result.missingKeyRefs > 0) {
    console.log(`  缺少 key 绑定:    ${result.missingKeyRefs}`);
  }

  if (dryRun) {
    console.log("\n[Dry-Run] 以上为预计操作，实际未执行任何删除。");
  }
}

async function runCleanup(
  redis: Redis,
  providers: ProviderRecord[],
  dryRun: boolean
): Promise<CleanupResult | null> {
  console.log("\n正在扫描 session 绑定...");
  const providerIds = new Set(providers.map((p) => p.id));
  const sessions = await findSessionsBoundToProviders(redis, providerIds);

  if (sessions.size === 0) {
    console.log("\n没有找到需要清理的 session 绑定。");
    return null;
  }

  console.log(`  匹配到 ${sessions.size} 个 session`);

  console.log("正在获取 session 的 key 绑定信息...");
  await populateSessionKeyBindings(redis, sessions);

  console.log(dryRun ? "\n[Dry-Run] 预计清理：" : "\n正在清理...");
  return clearSessionBindings(redis, sessions, dryRun);
}

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("  Claude Code Hub - Session 绑定清理工具");
  console.log("=".repeat(60));

  const options = parseCliArgs(process.argv.slice(2));

  if (options.dryRun) {
    console.log("\n[Dry-Run 模式] 仅显示将要执行的操作，不实际删除数据\n");
  }

  const dsn = process.env.DSN;
  if (!dsn) throw new Error("DSN 环境变量未设置");

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL 环境变量未设置");

  console.log("正在连接数据库...");
  const { client, db } = createDatabaseConnection(dsn);
  let redis: Redis | null = null;
  let menu: InteractiveMenu | null = null;

  try {
    let targetProviders: ProviderRecord[] = [];

    if (options.mode === "interactive") {
      // 交互式模式
      menu = new InteractiveMenu();
      const allProviders = await fetchAllProviders(db);

      if (allProviders.length === 0) {
        console.log("\n数据库中没有供应商。");
        return;
      }

      const action = await menu.selectMainAction();

      if (action === "quit") {
        console.log("\n已退出。");
        return;
      }

      if (action === "priority") {
        const threshold = await menu.inputPriority();
        if (threshold === null) return;
        targetProviders = allProviders.filter((p) => p.priority < threshold);
      } else if (action === "type") {
        const selectedType = await menu.selectProviderType(allProviders);
        if (selectedType === null) {
          // 返回主菜单
          const retryAction = await menu.selectMainAction();
          if (retryAction === "quit") {
            console.log("\n已退出。");
            return;
          }
          // 简单处理：重新开始
          console.log("\n请重新运行脚本。");
          return;
        }
        const filteredProviders =
          selectedType === "all"
            ? allProviders
            : allProviders.filter((p) => p.providerType === selectedType);

        if (filteredProviders.length === 0) {
          console.log(`\n没有找到类型为 "${selectedType}" 的供应商。`);
          return;
        }

        // 从筛选后的列表中选择
        targetProviders = await menu.selectProviders(filteredProviders);
      } else if (action === "name") {
        const pattern = await menu.inputNamePattern();
        if (!pattern) return;
        targetProviders = allProviders.filter((p) =>
          p.name.toLowerCase().includes(pattern.toLowerCase())
        );
      } else {
        targetProviders = await menu.selectProviders(allProviders);
      }

      if (targetProviders.length === 0) {
        console.log("\n未选择任何供应商。");
        return;
      }

      displaySelectedProviders(targetProviders);

      if (!options.dryRun) {
        const confirmed = await menu.confirm("\n确认清理这些供应商的 session 绑定？");
        if (!confirmed) {
          console.log("\n操作已取消。");
          return;
        }
      }
    } else {
      // 命令行模式
      if (options.mode === "priority") {
        targetProviders = await fetchProvidersByPriority(
          db,
          options.priorityThreshold!,
          options.providerType
        );
      } else if (options.mode === "id") {
        targetProviders = await fetchProvidersByIds(db, options.providerIds!);
      } else if (options.mode === "name") {
        targetProviders = await fetchProvidersByName(db, options.namePattern!);
      }

      if (targetProviders.length === 0) {
        console.log("\n未找到符合条件的供应商。");
        return;
      }

      displaySelectedProviders(targetProviders);

      if (!options.assumeYes && !options.dryRun) {
        menu = new InteractiveMenu();
        const confirmed = await menu.confirm("\n确认清理这些供应商的 session 绑定？");
        if (!confirmed) {
          console.log("\n操作已取消。");
          return;
        }
      }
    }

    // 连接 Redis 并执行清理
    console.log("\n正在连接 Redis...");
    redis = await createRedisClient(redisUrl);
    console.log("Redis 连接成功");

    const result = await runCleanup(redis, targetProviders, options.dryRun);

    if (result) {
      displayResult(result, options.dryRun);
    }

    console.log();
  } finally {
    menu?.close();
    await safeCloseRedis(redis);
    await safeClosePostgres(client);
  }
}

main()
  .catch((error) => {
    console.error("\n发生错误:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
