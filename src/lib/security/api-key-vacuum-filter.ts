import { logger } from "@/lib/logger";
import { VacuumFilter } from "@/lib/vacuum-filter/vacuum-filter";

function randomBytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  const webCrypto = (globalThis as unknown as { crypto?: { getRandomValues(bytes: Uint8Array): void } })
    .crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    webCrypto.getRandomValues(out);
    return out;
  }

  // 兜底：极端环境无 Web Crypto 时，使用 Math.random（仅用于 seed，不影响正确性）
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

type ApiKeyVacuumFilterStats = {
  enabled: boolean;
  ready: boolean;
  loading: boolean;
  lastReloadAt: number | null;
  sourceKeyCount: number;
  filterSize: number;
  filterLoadFactor: number;
  fingerprintBits: number;
  maxKickSteps: number;
};

type ReloadOptions = {
  reason: string;
};

/**
 * 纯构建函数：从 key 列表构建 VacuumFilter。
 *
 * 导出原因：
 * - 便于测试（不依赖 DB）
 * - 便于未来扩展（例如：从 Redis/文件加载快照）
 */
export function buildVacuumFilterFromKeyStrings(options: {
  keyStrings: string[];
  fingerprintBits: number;
  maxKickSteps: number;
  seed: Uint8Array;
}): VacuumFilter {
  const { keyStrings, fingerprintBits, maxKickSteps, seed } = options;

  const uniqueKeys = Array.from(new Set(keyStrings)).filter((v) => v.length > 0);

  // 目标：尽量接近 Vacuum Filter 的高负载设计点，同时给“增量新增 key”留少量 headroom，
  // 避免刚重建就接近极限导致频繁 insert_failed 重建。
  const targetLoadFactor = 0.96;
  const desiredLoadFactor = 0.9;
  let maxItems = Math.max(
    128,
    Math.ceil((uniqueKeys.length * targetLoadFactor) / desiredLoadFactor)
  );
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 6; attempt++) {
    const vf = new VacuumFilter({
      maxItems,
      fingerprintBits,
      maxKickSteps,
      seed,
      targetLoadFactor,
    });

    let okAll = true;
    for (const key of uniqueKeys) {
      if (!vf.add(key)) {
        okAll = false;
        break;
      }
    }

    if (okAll) {
      return vf;
    }

    lastError = new Error(`build failed at attempt=${attempt}, maxItems=${maxItems}`);
    maxItems = Math.ceil(maxItems * 1.6);
  }

  throw lastError ?? new Error("Vacuum filter build failed");
}

/**
 * API Key Vacuum Filter（进程级单例）
 *
 * 用途：
 * - 在访问数据库前，先用真空过滤器快速判定“肯定不存在”的 key，直接拒绝（减少 DB 压力、抵御爆破）
 *
 * 关键安全语义：
 * - 仅用于“负向短路”：filter.has(key)===false 才能“肯定不存在”
 * - filter.has(key)===true 只代表“可能存在”，仍必须走 DB 校验（避免假阳性误放行）
 *
 * 正确性约束：
 * - 允许“过度包含”（比如包含禁用/过期 key，甚至包含已删除 key 的 fingerprint），只会降低短路命中率，不影响安全性。
 * - 严禁“漏包含”有效 key：否则会产生错误拒绝。因此：
 *   - 启动时尽量从 DB 全量加载（见 instrumentation）
 *   - 新增 key 时增量写入（createKey -> noteExistingKey）
 */
class ApiKeyVacuumFilter {
  private readonly enabled: boolean;
  private readonly seed: Uint8Array;
  private readonly fingerprintBits = 32;
  private readonly maxKickSteps = 500;

  private vf: VacuumFilter | null = null;
  private loadingPromise: Promise<void> | null = null;

  private lastReloadAttemptAt: number | null = null;
  private readonly reloadCooldownMs = 10_000;

  private lastReloadAt: number | null = null;
  private sourceKeyCount = 0;

  constructor() {
    // 默认开启；若需要可通过环境变量关闭（避免在无 DB 场景产生额外日志）
    const isEdgeRuntime =
      typeof process !== "undefined" && process.env.NEXT_RUNTIME === "edge";
    this.enabled = !isEdgeRuntime && process.env.ENABLE_API_KEY_VACUUM_FILTER !== "false";
    this.seed = randomBytes(16);
  }

  /**
   * 返回：
   * - true：过滤器“肯定判断不存在”（可直接拒绝）
   * - false：过滤器认为“可能存在”（必须继续走 DB）
   * - null：过滤器未就绪或未启用（不要短路）
   */
  isDefinitelyNotPresent(keyString: string): boolean | null {
    if (!this.enabled) return null;

    const vf = this.vf;
    if (!vf) {
      // 懒加载：第一次触发时后台预热（同时保持“安全优先”：不就绪时不短路）
      this.startBackgroundReload({ reason: "lazy_warmup" });
      return null;
    }

    return vf.has(keyString) ? false : true;
  }

  /**
   * 将一个“已确认为存在”的 key 写入过滤器（尽量保持新建 key 的即时可用性）。
   *
   * 注意：写入失败不会影响正确性（仍会走 DB），只是降低短路命中率；失败后可依赖后台重建修复。
   */
  noteExistingKey(keyString: string): void {
    const vf = this.vf;
    if (!vf) return;

    // 注意：不要用 vf.has(key) 来“去重” —— has 可能是短暂假阳性，后续插入/搬移可能让假阳性消失，
    // 从而导致真正存在的 key 没被写入、最终产生误拒绝风险。对新建 key（应唯一）直接 add 更安全。
    const ok = vf.add(keyString);
    if (!ok) {
      logger.warn("[ApiKeyVacuumFilter] Insert failed; scheduling rebuild", {
        keyLength: keyString.length,
      });
      // 安全优先：插入失败意味着新 key 可能未被覆盖。
      // 为避免误拒绝（假阴性），临时禁用短路，等待后台重建完成后再恢复。
      this.vf = null;
      this.startBackgroundReload({ reason: "insert_failed" });
    }
  }

  startBackgroundReload(options: ReloadOptions): void {
    if (!this.enabled) return;
    if (this.loadingPromise) return;

    const now = Date.now();
    if (this.lastReloadAttemptAt && now - this.lastReloadAttemptAt < this.reloadCooldownMs) {
      return;
    }
    this.lastReloadAttemptAt = now;

    this.loadingPromise = this.reloadFromDatabase(options)
      .catch((error) => {
        logger.warn("[ApiKeyVacuumFilter] Reload failed", {
          reason: options.reason,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.loadingPromise = null;
      });
  }

  getStats(): ApiKeyVacuumFilterStats {
    const vf = this.vf;
    return {
      enabled: this.enabled,
      ready: !!vf,
      loading: !!this.loadingPromise,
      lastReloadAt: this.lastReloadAt,
      sourceKeyCount: this.sourceKeyCount,
      filterSize: vf?.size() ?? 0,
      filterLoadFactor: vf?.loadFactor() ?? 0,
      fingerprintBits: this.fingerprintBits,
      maxKickSteps: this.maxKickSteps,
    };
  }

  // ==================== 预热/重建 ====================

  private async reloadFromDatabase(options: ReloadOptions): Promise<void> {
    // CI / 测试环境通常不接 DB；避免大量告警日志
    const dsn = process.env.DSN || "";
    if (
      process.env.CI === "true" ||
      process.env.NODE_ENV === "test" ||
      process.env.VITEST === "true" ||
      !dsn ||
      dsn.includes("user:password@host:port")
    ) {
      logger.debug("[ApiKeyVacuumFilter] Skip reload (test env or DB not configured)");
      return;
    }

    // 延迟 import，避免构建/测试阶段触发 DB 初始化
    const [{ db }, { keys }, { isNull }] = await Promise.all([
      import("@/drizzle/db"),
      import("@/drizzle/schema"),
      import("drizzle-orm"),
    ]);

    const rows = await db
      .select({ key: keys.key })
      .from(keys)
      // 仅排除逻辑删除；禁用/过期 key 保留在 filter 中（安全：不会误拒绝）
      .where(isNull(keys.deletedAt));

    const keyStrings = rows
      .map((r) => r.key)
      .filter((v): v is string => typeof v === "string" && v.length > 0);

    const built = buildVacuumFilterFromKeyStrings({
      keyStrings,
      fingerprintBits: this.fingerprintBits,
      maxKickSteps: this.maxKickSteps,
      seed: this.seed,
    });

    this.vf = built;
    this.sourceKeyCount = new Set(keyStrings).size;
    this.lastReloadAt = Date.now();

    logger.info("[ApiKeyVacuumFilter] Reloaded", {
      reason: options.reason,
      keyCount: this.sourceKeyCount,
      loadFactor: Number(built.loadFactor().toFixed(4)),
    });
  }
}

// 使用 globalThis 保证单例（避免开发环境热重载重复实例化）
const g = globalThis as unknown as { __CCH_API_KEY_VACUUM_FILTER__?: ApiKeyVacuumFilter };
if (!g.__CCH_API_KEY_VACUUM_FILTER__) {
  g.__CCH_API_KEY_VACUUM_FILTER__ = new ApiKeyVacuumFilter();
}

export const apiKeyVacuumFilter = g.__CCH_API_KEY_VACUUM_FILTER__;
