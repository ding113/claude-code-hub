import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis/client";
import { type ClientInfo, parseUserAgent } from "@/lib/ua-parser";
import { isVersionGreater, isVersionLess } from "@/lib/version";
import { getActiveUserVersions, type RawUserVersion } from "@/repository/client-versions";

/**
 * Redis Key 前缀
 */
const REDIS_KEYS = {
  /** 用户当前版本: client_version:{clientType}:{userId} */
  userVersion: (clientType: string, userId: number) => `client_version:${clientType}:${userId}`,

  /** GA 版本缓存: ga_version:{clientType} */
  gaVersion: (clientType: string) => `ga_version:${clientType}`,
};

/**
 * TTL 配置（秒）
 */
const TTL = {
  USER_VERSION: 7 * 24 * 60 * 60, // 7 天（匹配活跃窗口）
  GA_VERSION: 5 * 60, // 5 分钟
};

/**
 * GA 版本检测阈值（从环境变量读取，默认 2）
 *
 * 阈值定义：当某个版本的用户数 >= 该值时，该版本被视为 GA 版本
 *
 * 配置方式：设置环境变量 CLIENT_VERSION_GA_THRESHOLD
 * 有效范围：1-10（超出范围会被强制到边界）
 */
const GA_THRESHOLD = (() => {
  const envValue = process.env.CLIENT_VERSION_GA_THRESHOLD;
  const parsed = envValue ? parseInt(envValue, 10) : 2; // 默认 2，与文档一致

  // 边界校验：范围 1-10
  if (Number.isNaN(parsed) || parsed < 1) {
    logger.warn(
      { envValue, parsed },
      "[ClientVersionChecker] Invalid GA_THRESHOLD, using minimum value 1"
    );
    return 1;
  }
  if (parsed > 10) {
    logger.warn(
      { envValue, parsed },
      "[ClientVersionChecker] GA_THRESHOLD exceeds maximum, using 10"
    );
    return 10;
  }

  logger.info({ gaThreshold: parsed }, "[ClientVersionChecker] GA_THRESHOLD configured");
  return parsed;
})();

/**
 * 客户端版本统计信息
 */
export interface ClientVersionStats {
  /**
   * 客户端类型
   *
   * 可能的值：
   * - "claude-vscode": VSCode 插件
   * - "claude-cli": 纯 CLI
   * - "claude-cli-unknown": 无法识别的旧版本
   * - "anthropic-sdk-typescript": SDK
   * - 其他客户端类型
   */
  clientType: string;
  /** 最新 GA 版本，无则为 null */
  gaVersion: string | null;
  /** 使用该客户端的总用户数 */
  totalUsers: number;
  /** 用户详情列表 */
  users: {
    userId: number;
    username: string;
    version: string;
    lastSeen: Date;
    isLatest: boolean; // 是否是最新版本
    needsUpgrade: boolean; // 是否需要升级
  }[];
}

/**
 * 客户端版本检测器
 *
 * 核心功能：
 * 1. 检测每种客户端的最新 GA 版本（1 个用户以上使用）
 * 2. 检查用户版本是否需要升级
 * 3. 追踪用户当前使用的版本
 *
 * 支持的客户端类型：
 * - claude-vscode: VSCode 插件（独立版本检测）
 * - claude-cli: 纯 CLI（独立版本检测）
 * - claude-cli-unknown: 无法识别的旧版本（独立版本检测）
 * - anthropic-sdk-typescript: SDK
 * - 其他客户端类型
 */
export class ClientVersionChecker {
  /**
   * 从用户列表计算 GA 版本（内存计算，不查询数据库）
   *
   * @param users - 用户版本列表（包含 version 字段）
   * @returns GA 版本号，无则返回 null
   * @private
   */
  private static computeGAVersionFromUsers(
    users: Array<{ userId: number; version: string }>
  ): string | null {
    if (users.length === 0) {
      return null;
    }

    // 1. 统计每个版本的用户数（去重）
    const versionCounts = new Map<string, Set<number>>();
    for (const user of users) {
      if (!versionCounts.has(user.version)) {
        versionCounts.set(user.version, new Set());
      }
      versionCounts.get(user.version)?.add(user.userId);
    }

    // 2. 找到用户数 >= GA_THRESHOLD 的最新版本
    let gaVersion: string | null = null;
    for (const [version, userIds] of versionCounts.entries()) {
      if (userIds.size >= GA_THRESHOLD) {
        if (!gaVersion || isVersionGreater(version, gaVersion)) {
          gaVersion = version;
        }
      }
    }

    return gaVersion;
  }

  /**
   * 检测指定客户端的最新 GA 版本
   *
   * GA 版本定义：被 1 个或以上用户使用的最新版本
   * 活跃窗口：过去 7 天内有请求的用户
   *
   * @param clientType - 客户端类型（如 "claude-vscode"、"claude-cli"、"claude-cli-unknown"）
   * @returns GA 版本号，无则返回 null
   *
   * @example
   * ```typescript
   * // VSCode 插件和 CLI 分别检测
   * const vscodeGA = await detectGAVersion("claude-vscode"); // "2.0.35"
   * const cliGA = await detectGAVersion("claude-cli");       // "2.0.33"
   * ```
   */
  static async detectGAVersion(clientType: string): Promise<string | null> {
    try {
      const redis = getRedisClient();

      // 1. 尝试从 Redis 读取缓存
      if (redis) {
        const cached = await redis.get(REDIS_KEYS.gaVersion(clientType));
        if (cached) {
          const data = JSON.parse(cached) as { version: string; userCount: number };
          logger.debug(
            { clientType, gaVersion: data.version },
            "[ClientVersionChecker] GA 版本缓存命中"
          );
          return data.version;
        }
      }

      // 2. 缓存未命中，查询数据库
      const activeUsers = await getActiveUserVersions(7);

      // 3. 解析所有 UA，过滤出指定客户端类型
      const clientUsers = activeUsers
        .map((user) => {
          const clientInfo = parseUserAgent(user.userAgent);
          return clientInfo && clientInfo.clientType === clientType
            ? { ...user, version: clientInfo.version }
            : null;
        })
        .filter((item): item is RawUserVersion & { version: string } => item !== null);

      if (clientUsers.length === 0) {
        logger.debug({ clientType }, "[ClientVersionChecker] 无活跃用户");
        return null;
      }

      // 4. 使用内存计算逻辑
      const gaVersion = ClientVersionChecker.computeGAVersionFromUsers(clientUsers);

      if (!gaVersion) {
        logger.debug({ clientType }, "[ClientVersionChecker] 无 GA 版本（暂无用户使用该版本）");
        return null;
      }

      // 5. 写入 Redis 缓存
      if (redis) {
        // 重新统计用户数（用于缓存）
        const versionCounts = new Map<string, Set<number>>();
        for (const user of clientUsers) {
          if (!versionCounts.has(user.version)) {
            versionCounts.set(user.version, new Set());
          }
          versionCounts.get(user.version)?.add(user.userId);
        }

        const cacheData = {
          version: gaVersion,
          userCount: versionCounts.get(gaVersion)?.size,
          updatedAt: Date.now(),
        };
        await redis.setex(
          REDIS_KEYS.gaVersion(clientType),
          TTL.GA_VERSION,
          JSON.stringify(cacheData)
        );
        logger.info(
          { clientType, gaVersion, userCount: cacheData.userCount },
          "[ClientVersionChecker] GA 版本已缓存"
        );
      }

      return gaVersion;
    } catch (error) {
      // Fail Open: 任何错误都返回 null
      logger.error({ error, clientType }, "[ClientVersionChecker] 检测 GA 版本失败");
      return null;
    }
  }

  /**
   * 检查用户版本是否需要升级
   *
   * @param clientType - 客户端类型
   * @param userVersion - 用户当前版本
   * @returns {needsUpgrade, gaVersion} - 是否需要升级及当前 GA 版本
   */
  static async shouldUpgrade(
    clientType: string,
    userVersion: string
  ): Promise<{ needsUpgrade: boolean; gaVersion: string | null }> {
    try {
      const gaVersion = await ClientVersionChecker.detectGAVersion(clientType);
      if (!gaVersion) {
        return { needsUpgrade: false, gaVersion: null }; // 无 GA 版本，放行
      }

      const needsUpgrade = isVersionLess(userVersion, gaVersion);
      return { needsUpgrade, gaVersion };
    } catch (error) {
      // Fail Open: 检查失败时放行
      logger.error({ error, clientType, userVersion }, "[ClientVersionChecker] 版本检查失败");
      return { needsUpgrade: false, gaVersion: null };
    }
  }

  /**
   * 更新用户当前使用的版本（异步，不阻塞主流程）
   *
   * @param userId - 用户 ID
   * @param clientType - 客户端类型
   * @param version - 版本号
   */
  static async updateUserVersion(
    userId: number,
    clientType: string,
    version: string
  ): Promise<void> {
    try {
      const redis = getRedisClient();
      if (!redis) {
        return; // Redis 不可用，跳过
      }

      const data = {
        version,
        lastSeen: Date.now(),
      };

      await redis.setex(
        REDIS_KEYS.userVersion(clientType, userId),
        TTL.USER_VERSION,
        JSON.stringify(data)
      );

      logger.debug({ userId, clientType, version }, "[ClientVersionChecker] 用户版本已更新");
    } catch (error) {
      // 非关键操作，仅记录日志
      logger.error(
        { error, userId, clientType, version },
        "[ClientVersionChecker] 更新用户版本失败"
      );
    }
  }

  /**
   * 获取所有客户端的版本统计（供前端使用）
   *
   * @returns 所有客户端的版本统计信息
   */
  static async getAllClientStats(): Promise<ClientVersionStats[]> {
    try {
      // 1. 查询活跃用户（一次性查询，避免 N+1）
      const activeUsers = await getActiveUserVersions(7);

      // 2. 解析 UA 并分组
      const clientGroups = new Map<string, Array<RawUserVersion & { clientInfo: ClientInfo }>>();

      for (const user of activeUsers) {
        const clientInfo = parseUserAgent(user.userAgent);
        if (!clientInfo) continue; // 解析失败，跳过

        if (!clientGroups.has(clientInfo.clientType)) {
          clientGroups.set(clientInfo.clientType, []);
        }
        clientGroups.get(clientInfo.clientType)?.push({ ...user, clientInfo });
      }

      // 3. 为每个客户端类型生成统计（使用内存计算，不再查询数据库）
      const stats: ClientVersionStats[] = [];

      for (const [clientType, users] of clientGroups.entries()) {
        // 去重：每个用户只保留最新版本
        const userMap = new Map<number, (typeof users)[0]>();
        for (const user of users) {
          const existing = userMap.get(user.userId);
          if (!existing) {
            userMap.set(user.userId, user);
          } else {
            if (isVersionGreater(user.clientInfo.version, existing.clientInfo.version)) {
              userMap.set(user.userId, user);
            }
          }
        }

        const uniqueUsers = Array.from(userMap.values());

        // 使用内存计算 GA 版本，避免重复查询数据库
        const usersWithVersion = uniqueUsers.map((u) => ({
          userId: u.userId,
          version: u.clientInfo.version,
        }));
        const gaVersion = ClientVersionChecker.computeGAVersionFromUsers(usersWithVersion);

        const userStats = uniqueUsers.map((user) => ({
          userId: user.userId,
          username: user.username,
          version: user.clientInfo.version,
          lastSeen: user.lastSeen,
          isLatest: gaVersion ? user.clientInfo.version === gaVersion : false,
          needsUpgrade: gaVersion ? isVersionLess(user.clientInfo.version, gaVersion) : false,
        }));

        stats.push({
          clientType,
          gaVersion,
          totalUsers: userStats.length,
          users: userStats,
        });
      }

      return stats;
    } catch (error) {
      logger.error({ error }, "[ClientVersionChecker] 获取客户端统计失败");
      return []; // Fail Open
    }
  }
}
