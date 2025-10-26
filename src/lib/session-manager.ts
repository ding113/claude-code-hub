import crypto from "crypto";
import { logger } from "@/lib/logger";
import { getRedisClient } from "./redis";
import { SessionTracker } from "./session-tracker";
import type {
  ActiveSessionInfo,
  SessionStoreInfo,
  SessionUsageUpdate,
  SessionProviderInfo,
} from "@/types/session";

/**
 * Session 管理器
 *
 * 核心功能：
 * 1. 基于 messages 内容哈希识别 session
 * 2. 管理 session 与 provider 的绑定关系
 * 3. 支持客户端主动传递 session_id
 * 4. 存储和查询活跃 session 详细信息（用于实时监控）
 */
export class SessionManager {
  private static readonly SESSION_TTL = parseInt(process.env.SESSION_TTL || "300"); // 5 分钟
  private static readonly STORE_MESSAGES = process.env.STORE_SESSION_MESSAGES === "true";
  private static readonly SHORT_CONTEXT_THRESHOLD = parseInt(
    process.env.SHORT_CONTEXT_THRESHOLD || "2"
  ); // 短上下文阈值
  private static readonly ENABLE_SHORT_CONTEXT_DETECTION =
    process.env.ENABLE_SHORT_CONTEXT_DETECTION !== "false"; // 默认启用

  /**
   * 从客户端请求中提取 session_id（支持 metadata 或 header）
   *
   * 优先级:
   * 1. metadata.user_id (Claude Code 主要方式，格式: "{user}_session_{sessionId}")
   * 2. metadata.session_id (备选方式)
   */
  static extractClientSessionId(requestMessage: Record<string, unknown>): string | null {
    const metadata = requestMessage.metadata;
    if (!metadata || typeof metadata !== "object") {
      return null;
    }

    const metadataObj = metadata as Record<string, unknown>;

    // 方案 A: 从 metadata.user_id 中提取 (Claude Code 主要方式)
    // 格式: "user_identifier_session_actual_session_id"
    if (typeof metadataObj.user_id === "string" && metadataObj.user_id.length > 0) {
      const userId = metadataObj.user_id;
      const sessionMarker = "_session_";
      const markerIndex = userId.indexOf(sessionMarker);

      if (markerIndex !== -1) {
        const extractedSessionId = userId.substring(markerIndex + sessionMarker.length);
        if (extractedSessionId.length > 0) {
          logger.trace("SessionManager: Extracted session from metadata.user_id", {
            sessionId: extractedSessionId,
          });
          return extractedSessionId;
        }
      }
    }

    // 方案 B: 直接从 metadata.session_id 读取 (备选方案)
    if (typeof metadataObj.session_id === "string" && metadataObj.session_id.length > 0) {
      logger.trace("SessionManager: Extracted session from metadata.session_id", {
        sessionId: metadataObj.session_id,
      });
      return metadataObj.session_id;
    }

    return null;
  }

  /**
   * 生成新的 session_id
   * 格式：sess_{timestamp}_{random}
   */
  static generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(6).toString("hex");
    return `sess_${timestamp}_${random}`;
  }

  /**
   * 计算 messages 内容哈希（用于 session 匹配）
   *
   * ⚠️ 注意: 这是一个降级方案,仅在无法从 metadata 提取 session ID 时使用
   * 不同会话如果开头相似可能产生相同哈希,因此优先使用 metadata.user_id
   *
   * @param messages - 消息数组
   * @returns 哈希值（16 字符）或 null
   */
  static calculateMessagesHash(messages: unknown): string | null {
    if (!Array.isArray(messages) || messages.length === 0) {
      logger.trace("SessionManager: calculateMessagesHash - messages is empty or not array");
      return null;
    }

    // 计算范围：前 N 条（N = min(length, 3)）
    const count = Math.min(messages.length, 3);
    const contents: string[] = [];

    for (let i = 0; i < count; i++) {
      const message = messages[i];
      if (message && typeof message === "object") {
        const messageObj = message as Record<string, unknown>;
        const content = messageObj.content;

        if (typeof content === "string") {
          contents.push(content);
          logger.trace("SessionManager: Message content (string)", {
            index: i,
            preview: content.substring(0, 100),
          });
        } else if (Array.isArray(content)) {
          // 支持多模态 content（数组格式）
          const textParts = content
            .filter(
              (item) =>
                item &&
                typeof item === "object" &&
                (item as Record<string, unknown>).type === "text"
            )
            .map((item) => (item as Record<string, unknown>).text);
          const joined = textParts.join("");
          contents.push(joined);
          logger.trace("SessionManager: Message content (array)", {
            index: i,
            preview: joined.substring(0, 100),
          });
        } else {
          logger.trace("SessionManager: Message content type (skipped)", {
            index: i,
            type: typeof content,
          });
        }
      }
    }

    if (contents.length === 0) {
      logger.trace("SessionManager: calculateMessagesHash - no valid contents extracted");
      return null;
    }

    // 拼接并计算 SHA-256 哈希
    const combined = contents.join("|");
    const hash = crypto.createHash("sha256").update(combined, "utf8").digest("hex");

    // 截取前 16 字符（足够区分，节省存储）
    const shortHash = hash.substring(0, 16);
    logger.trace("SessionManager: Calculated hash", {
      hash: shortHash,
      messageCount: contents.length,
      totalChars: combined.length,
    });

    return shortHash;
  }

  /**
   * 获取或创建 session_id（核心方法）
   *
   * @param keyId - API Key ID
   * @param messages - 消息数组
   * @param clientSessionId - 客户端传递的 session_id（可选）
   * @returns session_id
   */
  static async getOrCreateSessionId(
    keyId: number,
    messages: unknown,
    clientSessionId?: string | null
  ): Promise<string> {
    const redis = getRedisClient();

    const messagesLength = Array.isArray(messages) ? messages.length : 0;

    logger.trace("SessionManager: getOrCreateSessionId called", {
      keyId,
      hasClientSession: !!clientSessionId,
      messagesLength,
    });

    // 1. 优先使用客户端传递的 session_id (来自 metadata.user_id 或 metadata.session_id)
    if (clientSessionId) {
      // 2. 短上下文并发检测（方案E）
      if (this.ENABLE_SHORT_CONTEXT_DETECTION && messagesLength <= this.SHORT_CONTEXT_THRESHOLD) {
        // 检查该 session 是否有其他请求正在运行
        const concurrentCount = await SessionTracker.getConcurrentCount(clientSessionId);

        if (concurrentCount > 0) {
          // 场景B：有并发请求 → 这是并发短任务 → 强制新建 session
          const newId = this.generateSessionId();
          logger.info("SessionManager: 检测到并发短任务，强制新建 session", {
            originalSessionId: clientSessionId,
            newSessionId: newId,
            messagesLength,
            existingConcurrentCount: concurrentCount,
          });
          return newId;
        }

        // 场景A：无并发 → 这可能是长对话的开始 → 允许复用
        logger.debug("SessionManager: 短上下文但 session 空闲，允许复用（长对话开始）", {
          sessionId: clientSessionId,
          messagesLength,
        });
      }

      // 3. 长上下文 or 无并发 → 正常复用
      logger.debug("SessionManager: Using client-provided session", { sessionId: clientSessionId });
      // 刷新 TTL（滑动窗口）
      if (redis && redis.status === "ready") {
        await this.refreshSessionTTL(clientSessionId).catch((err) => {
          logger.error("SessionManager: Failed to refresh TTL", { error: err });
        });
      }
      return clientSessionId;
    }

    // 2. 降级方案：计算 messages 内容哈希（TC-047 警告：不可靠）
    logger.warn(
      "SessionManager: No client session ID, falling back to content hash (unreliable for compressed dialogs)",
      {
        keyId,
        messagesLength: Array.isArray(messages) ? messages.length : 0,
      }
    );
    const contentHash = this.calculateMessagesHash(messages);
    if (!contentHash) {
      // 降级：无法计算哈希，生成新 session
      const newId = this.generateSessionId();
      logger.warn("SessionManager: Cannot calculate hash, generating new session", {
        sessionId: newId,
      });
      return newId;
    }

    // 3. 尝试从 Redis 查找已有 session
    if (redis && redis.status === "ready") {
      try {
        const hashKey = `hash:${contentHash}:session`;
        const existingSessionId = await redis.get(hashKey);

        if (existingSessionId) {
          // 找到已有 session，刷新 TTL
          await this.refreshSessionTTL(existingSessionId);
          logger.trace("SessionManager: Reusing session via hash", {
            sessionId: existingSessionId,
            hash: contentHash,
          });
          return existingSessionId;
        }

        // 未找到：创建新 session
        const newSessionId = this.generateSessionId();

        // 存储映射关系（异步，不阻塞）
        void this.storeSessionMapping(contentHash, newSessionId, keyId);

        logger.trace("SessionManager: Created new session with hash", {
          sessionId: newSessionId,
          hash: contentHash,
        });
        return newSessionId;
      } catch (error) {
        logger.error("SessionManager: Redis error", { error });
        // 降级：Redis 错误，生成新 session
        return this.generateSessionId();
      }
    }

    // 4. Redis 不可用，降级生成新 session
    return this.generateSessionId();
  }

  /**
   * 存储 hash → session 映射关系
   */
  private static async storeSessionMapping(
    contentHash: string,
    sessionId: string,
    keyId: number
  ): Promise<void> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return;

    try {
      const pipeline = redis.pipeline();
      const hashKey = `hash:${contentHash}:session`;

      // 存储映射关系
      pipeline.setex(hashKey, this.SESSION_TTL, sessionId);

      // 初始化 session 元数据
      pipeline.setex(`session:${sessionId}:key`, this.SESSION_TTL, keyId.toString());
      pipeline.setex(`session:${sessionId}:last_seen`, this.SESSION_TTL, Date.now().toString());

      await pipeline.exec();
    } catch (error) {
      logger.error("SessionManager: Failed to store session mapping", { error });
    }
  }

  /**
   * 刷新 session TTL（滑动窗口）
   */
  private static async refreshSessionTTL(sessionId: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return;

    try {
      const pipeline = redis.pipeline();

      // 刷新所有 session 相关 key 的 TTL
      pipeline.expire(`session:${sessionId}:key`, this.SESSION_TTL);
      pipeline.expire(`session:${sessionId}:provider`, this.SESSION_TTL);
      pipeline.setex(`session:${sessionId}:last_seen`, this.SESSION_TTL, Date.now().toString());

      await pipeline.exec();
    } catch (error) {
      logger.error("SessionManager: Failed to refresh TTL", { error });
    }
  }

  /**
   * 绑定 session 到 provider（TC-009 修复：使用 SET NX 避免竞态条件）
   */
  static async bindSessionToProvider(sessionId: string, providerId: number): Promise<void> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return;

    try {
      const key = `session:${sessionId}:provider`;
      // 使用 SET ... NX 保证只有第一次绑定成功（原子操作）
      const result = await redis.set(
        key,
        providerId.toString(),
        "EX",
        this.SESSION_TTL,
        "NX" // Only set if not exists
      );

      if (result === "OK") {
        logger.trace("SessionManager: Bound session to provider", { sessionId, providerId });
      } else {
        // 已绑定过，不覆盖（避免并发请求选择不同供应商）
        logger.debug("SessionManager: Session already bound, skipping", {
          sessionId,
          attemptedProviderId: providerId,
        });
      }
    } catch (error) {
      logger.error("SessionManager: Failed to bind provider", { error });
    }
  }

  /**
   * 获取 session 绑定的 provider
   */
  static async getSessionProvider(sessionId: string): Promise<number | null> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return null;

    try {
      const value = await redis.get(`session:${sessionId}:provider`);
      if (value) {
        const providerId = parseInt(value, 10);
        if (!isNaN(providerId)) {
          return providerId;
        }
      }
    } catch (error) {
      logger.error("SessionManager: Failed to get session provider", { error });
    }

    return null;
  }

  /**
   * 存储 session 基础信息（请求开始时调用）
   */
  static async storeSessionInfo(sessionId: string, info: SessionStoreInfo): Promise<void> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return;

    try {
      const pipeline = redis.pipeline();

      // 存储详细信息到 Hash
      pipeline.hset(`session:${sessionId}:info`, {
        userName: info.userName,
        userId: info.userId.toString(),
        keyId: info.keyId.toString(),
        keyName: info.keyName,
        model: info.model || "",
        apiType: info.apiType,
        startTime: Date.now().toString(),
        status: "in_progress", // 初始状态
      });

      // 设置 TTL
      pipeline.expire(`session:${sessionId}:info`, this.SESSION_TTL);

      await pipeline.exec();
      logger.trace("SessionManager: Stored session info", { sessionId });
    } catch (error) {
      logger.error("SessionManager: Failed to store session info", { error });
    }
  }

  /**
   * 更新 session 供应商信息（选择供应商后调用）
   */
  static async updateSessionProvider(
    sessionId: string,
    providerInfo: SessionProviderInfo
  ): Promise<void> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return;

    try {
      const pipeline = redis.pipeline();

      // 更新 info Hash 中的 provider 字段
      pipeline.hset(`session:${sessionId}:info`, {
        providerId: providerInfo.providerId.toString(),
        providerName: providerInfo.providerName,
      });

      // 刷新 TTL
      pipeline.expire(`session:${sessionId}:info`, this.SESSION_TTL);

      await pipeline.exec();
      logger.trace("SessionManager: Updated session provider", {
        sessionId,
        providerName: providerInfo.providerName,
      });
    } catch (error) {
      logger.error("SessionManager: Failed to update session provider", { error });
    }
  }

  /**
   * 更新 session 使用量和状态（响应完成时调用）
   */
  static async updateSessionUsage(sessionId: string, usage: SessionUsageUpdate): Promise<void> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return;

    try {
      const pipeline = redis.pipeline();

      // 存储使用量到单独的 Hash
      const usageData: Record<string, string> = {
        status: usage.status,
      };

      if (usage.inputTokens !== undefined) {
        usageData.inputTokens = usage.inputTokens.toString();
      }
      if (usage.outputTokens !== undefined) {
        usageData.outputTokens = usage.outputTokens.toString();
      }
      if (usage.cacheCreationInputTokens !== undefined) {
        usageData.cacheCreationInputTokens = usage.cacheCreationInputTokens.toString();
      }
      if (usage.cacheReadInputTokens !== undefined) {
        usageData.cacheReadInputTokens = usage.cacheReadInputTokens.toString();
      }
      if (usage.costUsd !== undefined) {
        usageData.costUsd = usage.costUsd;
      }
      if (usage.statusCode !== undefined) {
        usageData.statusCode = usage.statusCode.toString();
      }
      if (usage.errorMessage !== undefined) {
        usageData.errorMessage = usage.errorMessage;
      }

      pipeline.hset(`session:${sessionId}:usage`, usageData);

      // 同时更新 info Hash 中的 status
      pipeline.hset(`session:${sessionId}:info`, "status", usage.status);

      // 刷新 TTL
      pipeline.expire(`session:${sessionId}:usage`, this.SESSION_TTL);
      pipeline.expire(`session:${sessionId}:info`, this.SESSION_TTL);

      await pipeline.exec();
      logger.trace("SessionManager: Updated session usage", { sessionId, status: usage.status });
    } catch (error) {
      logger.error("SessionManager: Failed to update session usage", { error });
    }
  }

  /**
   * 存储 session 请求 messages（可选，受环境变量控制）
   */
  static async storeSessionMessages(sessionId: string, messages: unknown): Promise<void> {
    if (!this.STORE_MESSAGES) {
      logger.trace("SessionManager: STORE_SESSION_MESSAGES is disabled, skipping");
      return;
    }

    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return;

    try {
      const messagesJson = JSON.stringify(messages);
      await redis.setex(`session:${sessionId}:messages`, this.SESSION_TTL, messagesJson);
      logger.trace("SessionManager: Stored session messages", { sessionId });
    } catch (error) {
      logger.error("SessionManager: Failed to store session messages", { error });
    }
  }

  /**
   * 辅助方法：从 Redis Hash 数据构建 ActiveSessionInfo 对象
   *
   * @private
   */
  private static buildSessionInfo(
    sessionId: string,
    info: Record<string, string>,
    usage: Record<string, string>
  ): ActiveSessionInfo {
    const startTime = parseInt(info.startTime || "0", 10);
    const now = Date.now();

    const session: ActiveSessionInfo = {
      sessionId,
      userName: info.userName || "unknown",
      userId: parseInt(info.userId || "0", 10),
      keyId: parseInt(info.keyId || "0", 10),
      keyName: info.keyName || "unknown",
      providerId: info.providerId ? parseInt(info.providerId, 10) : null,
      providerName: info.providerName || null,
      model: info.model || null,
      apiType: (info.apiType as "chat" | "codex") || "chat",
      startTime,
      status: (usage.status || info.status || "in_progress") as
        | "in_progress"
        | "completed"
        | "error",
      durationMs: startTime > 0 ? now - startTime : undefined,
    };

    // 添加 usage 数据（如果存在）
    if (usage && Object.keys(usage).length > 0) {
      if (usage.inputTokens) session.inputTokens = parseInt(usage.inputTokens, 10);
      if (usage.outputTokens) session.outputTokens = parseInt(usage.outputTokens, 10);
      if (usage.cacheCreationInputTokens)
        session.cacheCreationInputTokens = parseInt(usage.cacheCreationInputTokens, 10);
      if (usage.cacheReadInputTokens)
        session.cacheReadInputTokens = parseInt(usage.cacheReadInputTokens, 10);
      if (usage.costUsd) session.costUsd = usage.costUsd;
      if (usage.statusCode) session.statusCode = parseInt(usage.statusCode, 10);
      if (usage.errorMessage) session.errorMessage = usage.errorMessage;

      // 计算总 token
      const input = session.inputTokens || 0;
      const output = session.outputTokens || 0;
      const cacheCreate = session.cacheCreationInputTokens || 0;
      const cacheRead = session.cacheReadInputTokens || 0;
      session.totalTokens = input + output + cacheCreate + cacheRead;
    }

    return session;
  }

  /**
   * 获取活跃 session 列表（用于实时监控页面）
   */
  static async getActiveSessions(): Promise<ActiveSessionInfo[]> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") {
      logger.warn("SessionManager: Redis not ready, returning empty list");
      return [];
    }

    try {
      // 1. 使用 SessionTracker 获取活跃 session ID（自动兼容 ZSET/Set）
      const sessionIds = await SessionTracker.getActiveSessions();
      if (sessionIds.length === 0) {
        return [];
      }

      logger.trace("SessionManager: Found active sessions", { count: sessionIds.length });

      // 2. 批量获取 session 详细信息
      const sessions: ActiveSessionInfo[] = [];
      const pipeline = redis.pipeline();

      for (const sessionId of sessionIds) {
        pipeline.hgetall(`session:${sessionId}:info`);
        pipeline.hgetall(`session:${sessionId}:usage`);
      }

      const results = await pipeline.exec();
      if (!results) {
        return [];
      }

      // 3. 解析结果
      for (let i = 0; i < sessionIds.length; i++) {
        const infoIndex = i * 2;
        const usageIndex = i * 2 + 1;

        const infoResult = results[infoIndex];
        const usageResult = results[usageIndex];

        // 检查结果有效性
        if (!infoResult || infoResult[0] !== null) continue;
        if (!usageResult || usageResult[0] !== null) continue;

        const info = infoResult[1] as Record<string, string>;
        const usage = usageResult[1] as Record<string, string>;

        // 跳过空的 info（session 可能已过期）
        if (!info || Object.keys(info).length === 0) continue;

        // 使用辅助方法构建 session 对象
        const session = this.buildSessionInfo(sessionIds[i], info, usage);
        sessions.push(session);
      }

      logger.trace("SessionManager: Retrieved active sessions with details", {
        count: sessions.length,
      });
      return sessions;
    } catch (error) {
      logger.error("SessionManager: Failed to get active sessions", { error });
      return [];
    }
  }

  /**
   * 获取所有 session（包括非活跃的）
   *
   * 使用 SCAN 扫描 Redis 中所有 session:*:info key，
   * 按最后活跃时间分为活跃（5 分钟内）和非活跃两组。
   *
   * @returns { active: 活跃 session 列表, inactive: 非活跃 session 列表 }
   */
  static async getAllSessionsWithExpiry(): Promise<{
    active: ActiveSessionInfo[];
    inactive: ActiveSessionInfo[];
  }> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") {
      logger.warn("SessionManager: Redis not ready, returning empty lists");
      return { active: [], inactive: [] };
    }

    try {
      const now = Date.now();
      const fiveMinutesAgo = now - this.SESSION_TTL * 1000; // SESSION_TTL 是秒，转为毫秒

      // 1. 使用 SCAN 扫描所有 session:*:info key
      const allSessions: ActiveSessionInfo[] = [];
      let cursor = "0";

      do {
        const [nextCursor, keys] = (await redis.scan(
          cursor,
          "MATCH",
          "session:*:info",
          "COUNT",
          100
        )) as [string, string[]];

        cursor = nextCursor;

        if (keys.length > 0) {
          // 2. 批量获取 session info 和 usage
          const pipeline = redis.pipeline();

          for (const key of keys) {
            pipeline.hgetall(key);
            // 提取 sessionId
            const sessionId = key.replace("session:", "").replace(":info", "");
            pipeline.hgetall(`session:${sessionId}:usage`);
          }

          const results = await pipeline.exec();
          if (!results) continue;

          // 3. 解析结果
          for (let i = 0; i < keys.length; i++) {
            const infoIndex = i * 2;
            const usageIndex = i * 2 + 1;

            const infoResult = results[infoIndex];
            const usageResult = results[usageIndex];

            // 检查结果有效性
            if (!infoResult || infoResult[0] !== null) continue;
            if (!usageResult || usageResult[0] !== null) continue;

            const info = infoResult[1] as Record<string, string>;
            const usage = usageResult[1] as Record<string, string>;

            // 跳过空的 info
            if (!info || Object.keys(info).length === 0) continue;

            // 提取 sessionId
            const sessionId = keys[i].replace("session:", "").replace(":info", "");

            // 使用辅助方法构建 session 对象
            const session = this.buildSessionInfo(sessionId, info, usage);
            allSessions.push(session);
          }
        }
      } while (cursor !== "0");

      // 4. 按最后活跃时间分组
      const active: ActiveSessionInfo[] = [];
      const inactive: ActiveSessionInfo[] = [];

      for (const session of allSessions) {
        if (session.startTime >= fiveMinutesAgo) {
          active.push(session);
        } else {
          inactive.push(session);
        }
      }

      logger.trace("SessionManager: Found sessions", {
        active: active.length,
        inactive: inactive.length,
        total: allSessions.length,
      });

      return { active, inactive };
    } catch (error) {
      logger.error("SessionManager: Failed to get all sessions", { error });
      return { active: [], inactive: [] };
    }
  }

  /**
   * 获取 session 的 messages 内容
   */
  static async getSessionMessages(sessionId: string): Promise<unknown | null> {
    if (!this.STORE_MESSAGES) {
      logger.warn("SessionManager: STORE_SESSION_MESSAGES is disabled");
      return null;
    }

    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return null;

    try {
      const messagesJson = await redis.get(`session:${sessionId}:messages`);
      if (!messagesJson) {
        return null;
      }
      return JSON.parse(messagesJson);
    } catch (error) {
      logger.error("SessionManager: Failed to get session messages", { error });
      return null;
    }
  }

  /**
   * 存储 session 响应体（临时存储，5分钟过期）
   *
   * @param sessionId - Session ID
   * @param response - 响应体内容（字符串或对象）
   */
  static async storeSessionResponse(sessionId: string, response: string | object): Promise<void> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return;

    try {
      const responseString = typeof response === "string" ? response : JSON.stringify(response);
      await redis.setex(`session:${sessionId}:response`, this.SESSION_TTL, responseString);
      logger.trace("SessionManager: Stored session response", {
        sessionId,
        size: responseString.length,
      });
    } catch (error) {
      logger.error("SessionManager: Failed to store session response", { error });
    }
  }

  /**
   * 获取 session 响应体
   *
   * @param sessionId - Session ID
   * @returns 响应体内容（字符串）
   */
  static async getSessionResponse(sessionId: string): Promise<string | null> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return null;

    try {
      const response = await redis.get(`session:${sessionId}:response`);
      return response;
    } catch (error) {
      logger.error("SessionManager: Failed to get session response", { error });
      return null;
    }
  }
}
