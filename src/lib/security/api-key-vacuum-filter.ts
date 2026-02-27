import { logger } from "@/lib/logger";
import { randomBytes } from "@/lib/vacuum-filter/random";
import { VacuumFilter } from "@/lib/vacuum-filter/vacuum-filter";

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
  /**
   * 是否强制触发（忽略 cooldown）。
   *
   * 用途：
   * - 多实例场景收到“key 已新增”的广播后，需要尽快重建避免误拒绝
   */
  force?: boolean;
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

  // 关键：当 vf 尚未就绪（或正在重建）时，新 key 可能在这段窗口期被创建。
  // 若不记录并在下一次重建时纳入，会导致“漏包含”有效 key，从而误拒绝（假阴性）。
  private pendingKeys = new Set<string>();
  private readonly pendingKeysLimit = 10_000;

  // 若重建过程中又收到新的重建请求（例如：多实例收到 key 创建广播），需要串行再跑一次。
  private pendingReloadReason: string | null = null;
  private pendingReloadForce = false;

  private lastReloadAttemptAt: number | null = null;
  private readonly reloadCooldownMs = 10_000;

  private lastReloadAt: number | null = null;
  private sourceKeyCount = 0;

  constructor() {
    // 默认开启：升级后无需额外配置即可启用（仅负向短路；不会影响鉴权正确性）。
    // 如需排查或节省资源，可通过环境变量显式关闭：ENABLE_API_KEY_VACUUM_FILTER=false/0
    if (typeof process === "undefined") {
      // Edge/浏览器等无 process 环境：强制关闭（避免访问 process.env 抛错）
      this.enabled = false;
    } else {
      const isEdgeRuntime = process.env.NEXT_RUNTIME === "edge";
      const raw = process.env.ENABLE_API_KEY_VACUUM_FILTER?.trim();
      const explicitlyDisabled = raw === "false" || raw === "0";
      this.enabled = !isEdgeRuntime && !explicitlyDisabled;
    }
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

    // 重建过程中：安全优先，不短路（避免使用可能过期的 vf 产生误拒绝）
    if (this.loadingPromise) {
      return null;
    }

    const vf = this.vf;
    if (!vf) {
      // 懒加载：第一次触发时后台预热（同时保持“安全优先”：不就绪时不短路）
      this.startBackgroundReload({ reason: "lazy_warmup" });
      return null;
    }

    return !vf.has(keyString);
  }

  /**
   * 将一个“已确认为存在”的 key 写入过滤器（尽量保持新建 key 的即时可用性）。
   *
   * 注意：写入失败不会影响正确性（仍会走 DB），只是降低短路命中率；失败后可依赖后台重建修复。
   */
  noteExistingKey(keyString: string): void {
    if (!this.enabled) return;
    const trimmed = keyString.trim();
    if (!trimmed) return;

    try {
      const vf = this.vf;
      if (!vf) {
        // vf 未就绪：记录到 pending，确保下一次重建会覆盖到该 key（避免误拒绝）
        if (this.pendingKeys.size < this.pendingKeysLimit) {
          this.pendingKeys.add(trimmed);
        } else {
          logger.warn("[ApiKeyVacuumFilter] Pending keys overflow; scheduling rebuild", {
            limit: this.pendingKeysLimit,
          });
        }
        this.startBackgroundReload({ reason: "pending_key", force: true });
        return;
      }

      // 重建进行中：同时写入 pending，确保新 filter 不会漏包含该 key
      if (this.loadingPromise) {
        if (this.pendingKeys.size < this.pendingKeysLimit) {
          this.pendingKeys.add(trimmed);
        } else {
          logger.warn("[ApiKeyVacuumFilter] Pending keys overflow; scheduling rebuild", {
            limit: this.pendingKeysLimit,
          });
        }

        // 合并重建请求：当前重建结束后再跑一次，确保纳入 pendingKeys
        this.startBackgroundReload({ reason: "pending_key_during_reload", force: true });
      }

      // 注意：不要用 vf.has(key) 来“去重” —— has 可能是短暂假阳性，后续插入/搬移可能让假阳性消失，
      // 从而导致真正存在的 key 没被写入、最终产生误拒绝风险。对新建 key（应唯一）直接 add 更安全。
      const ok = vf.add(trimmed);
      if (!ok) {
        logger.warn("[ApiKeyVacuumFilter] Insert failed; scheduling rebuild", {
          keyLength: trimmed.length,
        });
        // 安全优先：插入失败意味着新 key 可能未被覆盖。
        // 为避免误拒绝（假阴性），临时禁用短路，等待后台重建完成后再恢复。
        if (this.pendingKeys.size < this.pendingKeysLimit) {
          this.pendingKeys.add(trimmed);
        } else {
          logger.warn("[ApiKeyVacuumFilter] Pending keys overflow; scheduling rebuild", {
            limit: this.pendingKeysLimit,
          });
        }
        this.vf = null;
        this.startBackgroundReload({ reason: "insert_failed", force: true });
      }
    } catch (error) {
      logger.warn("[ApiKeyVacuumFilter] noteExistingKey failed; scheduling rebuild", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (this.pendingKeys.size < this.pendingKeysLimit) {
        this.pendingKeys.add(trimmed);
      } else {
        logger.warn("[ApiKeyVacuumFilter] Pending keys overflow; scheduling rebuild", {
          limit: this.pendingKeysLimit,
        });
      }
      this.vf = null;
      try {
        this.startBackgroundReload({ reason: "note_existing_key_failed", force: true });
      } catch {
        // ignore
      }
    }
  }

  /**
   * 外部触发：标记过滤器可能已过期，并强制后台重建。
   *
   * 典型场景：多实例环境下，某个实例创建了新 key；其它实例需要尽快重建，避免误拒绝。
   */
  invalidateAndReload(options: ReloadOptions): void {
    if (!this.enabled) return;
    this.vf = null;
    this.startBackgroundReload({ ...options, force: true });
  }

  startBackgroundReload(options: ReloadOptions): void {
    if (!this.enabled) return;
    if (this.loadingPromise) {
      // 重建进行中：合并请求，待当前重建结束后再跑一次（避免“读到旧快照”漏新 key）
      this.pendingReloadReason = options.reason;
      this.pendingReloadForce = this.pendingReloadForce || options.force === true;
      return;
    }

    const now = Date.now();
    if (
      options.force !== true &&
      this.lastReloadAttemptAt &&
      now - this.lastReloadAttemptAt < this.reloadCooldownMs
    ) {
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

        // 若重建期间又收到新的重建请求，串行补一次（避免漏 key）
        if (this.pendingReloadReason) {
          const reason = this.pendingReloadReason;
          const force = this.pendingReloadForce;
          this.pendingReloadReason = null;
          this.pendingReloadForce = false;
          this.startBackgroundReload({ reason, force });
        }
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
    const embeddedDbEnabled =
      process.env.CCH_EMBEDDED_DB === "true" ||
      process.env.CCH_EMBEDDED_DB === "1" ||
      process.env.CCH_EMBEDDED_DB === "yes";
    if (
      process.env.CI === "true" ||
      process.env.NODE_ENV === "test" ||
      process.env.VITEST === "true" ||
      ((!dsn || dsn.includes("user:password@host:port")) && !embeddedDbEnabled)
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

    // 将 pendingKeys 合并进来：覆盖“重建窗口期创建的新 key”。
    // 通过“Set 交换”获得快照，避免 snapshot-merge-clear 的竞态窗口：
    // - reload 期间新增的 key 会进入新的 pendingKeys
    // - 本次快照 key 会被纳入 built filter
    // - 若 build 失败，会将快照 key 合并回 pendingKeys，避免漏 key
    const pendingSnapshotSet = this.pendingKeys;
    this.pendingKeys = new Set<string>();
    const pendingSnapshot =
      pendingSnapshotSet.size > 0 ? Array.from(pendingSnapshotSet.values()) : [];

    let built: VacuumFilter;
    try {
      built = buildVacuumFilterFromKeyStrings({
        keyStrings: pendingSnapshot.length > 0 ? keyStrings.concat(pendingSnapshot) : keyStrings,
        fingerprintBits: this.fingerprintBits,
        maxKickSteps: this.maxKickSteps,
        seed: this.seed,
      });
    } catch (error) {
      // build 失败：回滚快照，避免漏 key（同时保留 reload 期间新增的 key）
      for (const k of pendingSnapshotSet.values()) {
        if (this.pendingKeys.size >= this.pendingKeysLimit) break;
        this.pendingKeys.add(k);
      }
      throw error;
    }

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
