/**
 * Redis Streams 客户端封装
 * 用于分布式 WebSocket 消息广播
 *
 * 功能:
 * - 消息发布 (XADD)
 * - 消息订阅 (XREAD blocking)
 * - 消费组管理 (XGROUP, XREADGROUP, XACK)
 * - 自动清理 (XTRIM)
 * - 错误处理和 Fail Open 策略
 */

import Redis from "ioredis";
import { logger } from "@/lib/logger";
import { buildRedisOptionsForUrl } from "./client";
import type {
  StreamMessage,
  StreamMessageId,
  StreamMessageCallback,
  SubscribeOptions,
  ConsumeGroupOptions,
  TrimOptions,
  StreamsClientConfig,
  SubscriptionState,
  ConsumerGroupState,
  XAddResult,
  XReadResult,
  XReadGroupResult,
  StreamsError,
} from "@/types/redis-streams";

/**
 * Redis Streams 客户端 (单例模式)
 */
export class RedisStreamsClient {
  private static instance: RedisStreamsClient | null = null;
  private redis: Redis | null = null;
  private isConnected = false;
  private config: Required<StreamsClientConfig>;

  // 订阅状态管理
  private subscriptions = new Map<string, SubscriptionState>();
  private consumerGroups = new Map<string, ConsumerGroupState>();

  // 清理任务管理
  private trimInterval: NodeJS.Timeout | null = null;

  private constructor(config: StreamsClientConfig = {}) {
    this.config = {
      defaultBlockMs: config.defaultBlockMs ?? 5000,
      defaultCount: config.defaultCount ?? 10,
      autoTrimInterval: config.autoTrimInterval ?? 3600000, // 1 hour
      defaultMaxLen: config.defaultMaxLen ?? 10000,
      enableAutoTrim: config.enableAutoTrim ?? true,
    };
  }

  /**
   * 获取 RedisStreamsClient 单例
   */
  public static getInstance(config?: StreamsClientConfig): RedisStreamsClient {
    if (!RedisStreamsClient.instance) {
      RedisStreamsClient.instance = new RedisStreamsClient(config);
    }
    return RedisStreamsClient.instance;
  }

  /**
   * 初始化 Redis 连接
   */
  public async connect(): Promise<void> {
    // Skip connection during CI/build phase
    if (process.env.CI === "true" || process.env.NEXT_PHASE === "phase-production-build") {
      logger.info("[RedisStreams] Skipping connection in CI/build phase");
      return;
    }

    const redisUrl = process.env.REDIS_URL;
    const isEnabled = process.env.ENABLE_RATE_LIMIT === "true";

    if (!isEnabled || !redisUrl) {
      logger.warn("[RedisStreams] Disabled or REDIS_URL not configured - Fail Open mode");
      return;
    }

    if (this.redis) {
      logger.info("[RedisStreams] Already connected");
      return;
    }

    try {
      const { options } = buildRedisOptionsForUrl(redisUrl);

      this.redis = new Redis(redisUrl, {
        ...options,
        lazyConnect: true, // 手动控制连接
      });

      // 事件监听
      this.redis.on("connect", () => {
        this.isConnected = true;
        logger.info("[RedisStreams] Connected successfully");
      });

      this.redis.on("ready", () => {
        logger.info("[RedisStreams] Ready to accept commands");
        this.startAutoTrim();
      });

      this.redis.on("error", (error) => {
        this.isConnected = false;
        logger.error("[RedisStreams] Connection error", {
          error: error instanceof Error ? error.message : String(error),
        });
      });

      this.redis.on("close", () => {
        this.isConnected = false;
        logger.warn("[RedisStreams] Connection closed");
      });

      this.redis.on("reconnecting", () => {
        logger.info("[RedisStreams] Reconnecting...");
      });

      // 执行连接
      await this.redis.connect();
    } catch (error) {
      logger.error("[RedisStreams] Failed to initialize:", error);
      this.redis = null;
      this.isConnected = false;
      // Fail Open: 不抛出异常，让服务继续运行
    }
  }

  /**
   * 关闭连接并清理资源
   */
  public async disconnect(): Promise<void> {
    // 停止所有订阅
    for (const state of this.subscriptions.values()) {
      state.active = false;
    }
    for (const state of this.consumerGroups.values()) {
      state.active = false;
    }

    // 停止自动清理
    this.stopAutoTrim();

    // 关闭 Redis 连接
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.isConnected = false;
    }

    logger.info("[RedisStreams] Disconnected successfully");
  }

  /**
   * 检查是否可用 (连接正常)
   */
  private isAvailable(): boolean {
    return !!this.redis && this.isConnected;
  }

  /**
   * 发布消息到 Stream (XADD)
   * @param stream - Stream 名称
   * @param data - 消息数据 (将被序列化为 JSON)
   * @param id - 消息 ID ('*' 表示自动生成, 默认: '*')
   * @returns 消息 ID 或 null (失败时)
   */
  public async publishMessage<T = unknown>(
    stream: string,
    data: T,
    id: StreamMessageId = "*"
  ): Promise<XAddResult> {
    if (!this.isAvailable()) {
      logger.warn("[RedisStreams] Redis unavailable, cannot publish message - Fail Open");
      return null;
    }

    try {
      // 序列化数据 (支持 BigInt)
      const serialized = JSON.stringify(data, (_, value) =>
        typeof value === "bigint" ? value.toString() : value
      );

      // XADD 命令: XADD stream id field value [field value ...]
      const messageId = await this.redis!.xadd(
        stream,
        id,
        "data",
        serialized,
        "timestamp",
        Date.now().toString()
      );

      logger.debug("[RedisStreams] Message published", {
        stream,
        messageId,
        dataSize: serialized.length,
      });

      return messageId;
    } catch (error) {
      logger.error("[RedisStreams] Failed to publish message", {
        stream,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fail Open: 返回 null 而不是抛出异常
      return null;
    }
  }

  /**
   * 订阅 Stream 消息 (XREAD blocking)
   * @param stream - Stream 名称
   * @param callback - 消息回调函数
   * @param options - 订阅配置
   */
  public async subscribe<T = unknown>(
    stream: string,
    callback: StreamMessageCallback<T>,
    options: SubscribeOptions = {}
  ): Promise<void> {
    if (!this.isAvailable()) {
      logger.warn("[RedisStreams] Redis unavailable, cannot subscribe - Fail Open");
      return;
    }

    const opts: SubscribeOptions = {
      startId: options.startId ?? "$", // 从最新消息开始
      blockMs: options.blockMs ?? this.config.defaultBlockMs,
      count: options.count ?? this.config.defaultCount,
    };

    // 创建订阅状态
    const state: SubscriptionState = {
      stream,
      active: true,
      lastId: opts.startId!,
      callback: callback as StreamMessageCallback,
      options: opts,
    };

    this.subscriptions.set(stream, state);

    logger.info("[RedisStreams] Subscription started", { stream, startId: opts.startId });

    // 启动阻塞读取循环
    this.startReadLoop(state).catch((error) => {
      logger.error("[RedisStreams] Read loop error", {
        stream,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * 取消订阅
   * @param stream - Stream 名称
   */
  public unsubscribe(stream: string): void {
    const state = this.subscriptions.get(stream);
    if (state) {
      state.active = false;
      this.subscriptions.delete(stream);
      logger.info("[RedisStreams] Subscription cancelled", { stream });
    }
  }

  /**
   * 创建消费组
   * @param stream - Stream 名称
   * @param group - 消费组名称
   * @param startId - 开始消费的消息 ID ('$' 表示最新消息, '0' 表示从头开始, 默认: '$')
   */
  public async createConsumerGroup(
    stream: string,
    group: string,
    startId: StreamMessageId = "$"
  ): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.warn("[RedisStreams] Redis unavailable, cannot create consumer group - Fail Open");
      return false;
    }

    try {
      // XGROUP CREATE stream group id [MKSTREAM]
      await this.redis!.xgroup("CREATE", stream, group, startId, "MKSTREAM");
      logger.info("[RedisStreams] Consumer group created", { stream, group, startId });
      return true;
    } catch (error) {
      // 如果消费组已存在，忽略错误
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes("BUSYGROUP")) {
        logger.debug("[RedisStreams] Consumer group already exists", { stream, group });
        return true;
      }

      logger.error("[RedisStreams] Failed to create consumer group", {
        stream,
        group,
        error: errMsg,
      });
      return false;
    }
  }

  /**
   * 从消费组消费消息 (XREADGROUP)
   * @param stream - Stream 名称
   * @param group - 消费组名称
   * @param consumer - 消费者名称
   * @param callback - 消息回调函数
   * @param options - 消费配置
   */
  public async consumeFromGroup<T = unknown>(
    stream: string,
    group: string,
    consumer: string,
    callback: StreamMessageCallback<T>,
    options: Partial<ConsumeGroupOptions> = {}
  ): Promise<void> {
    if (!this.isAvailable()) {
      logger.warn("[RedisStreams] Redis unavailable, cannot consume from group - Fail Open");
      return;
    }

    // 确保消费组存在
    const created = await this.createConsumerGroup(stream, group, "0");
    if (!created) {
      logger.error("[RedisStreams] Cannot start consuming without consumer group", {
        stream,
        group,
      });
      return;
    }

    const opts: ConsumeGroupOptions = {
      group,
      consumer,
      startId: options.startId ?? ">", // '>' 表示只消费未传递的新消息
      blockMs: options.blockMs ?? this.config.defaultBlockMs,
      count: options.count ?? this.config.defaultCount,
      autoAck: options.autoAck ?? true,
    };

    // 创建消费组状态
    const state: ConsumerGroupState = {
      stream,
      group,
      consumer,
      active: true,
      callback: callback as StreamMessageCallback,
      options: opts,
    };

    const key = `${stream}:${group}:${consumer}`;
    this.consumerGroups.set(key, state);

    logger.info("[RedisStreams] Consumer started", {
      stream,
      group,
      consumer,
      startId: opts.startId,
    });

    // 启动消费循环
    this.startConsumeLoop(state).catch((error) => {
      logger.error("[RedisStreams] Consume loop error", {
        stream,
        group,
        consumer,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * 停止消费组消费
   * @param stream - Stream 名称
   * @param group - 消费组名称
   * @param consumer - 消费者名称
   */
  public stopConsumer(stream: string, group: string, consumer: string): void {
    const key = `${stream}:${group}:${consumer}`;
    const state = this.consumerGroups.get(key);
    if (state) {
      state.active = false;
      this.consumerGroups.delete(key);
      logger.info("[RedisStreams] Consumer stopped", { stream, group, consumer });
    }
  }

  /**
   * 确认消息 (XACK)
   * @param stream - Stream 名称
   * @param group - 消费组名称
   * @param messageIds - 消息 ID 列表
   * @returns 确认的消息数量
   */
  public async acknowledgeMessages(
    stream: string,
    group: string,
    ...messageIds: StreamMessageId[]
  ): Promise<number> {
    if (!this.isAvailable()) {
      logger.warn("[RedisStreams] Redis unavailable, cannot ACK messages - Fail Open");
      return 0;
    }

    try {
      // XACK stream group id [id ...]
      const count = await this.redis!.xack(stream, group, ...messageIds);

      logger.debug("[RedisStreams] Messages acknowledged", {
        stream,
        group,
        count,
        messageIds,
      });

      return count;
    } catch (error) {
      logger.error("[RedisStreams] Failed to ACK messages", {
        stream,
        group,
        messageIds,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * 清理 Stream (XTRIM)
   * @param stream - Stream 名称
   * @param options - 清理配置
   * @returns 删除的消息数量
   */
  public async trimStream(stream: string, options: TrimOptions = {}): Promise<number> {
    if (!this.isAvailable()) {
      logger.warn("[RedisStreams] Redis unavailable, cannot trim stream - Fail Open");
      return 0;
    }

    const opts: TrimOptions = {
      maxLen: options.maxLen ?? this.config.defaultMaxLen,
      approximate: options.approximate ?? true,
    };

    try {
      // XTRIM stream MAXLEN [~] count
      let deleted: number;
      if (opts.approximate) {
        deleted = await this.redis!.xtrim(stream, "MAXLEN", "~", opts.maxLen!);
      } else {
        deleted = await this.redis!.xtrim(stream, "MAXLEN", opts.maxLen!);
      }

      logger.debug("[RedisStreams] Stream trimmed", {
        stream,
        deleted,
        maxLen: opts.maxLen,
        approximate: opts.approximate,
      });

      return deleted;
    } catch (error) {
      logger.error("[RedisStreams] Failed to trim stream", {
        stream,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * 启动阻塞读取循环 (XREAD)
   * @private
   */
  private async startReadLoop(state: SubscriptionState): Promise<void> {
    while (state.active && this.isAvailable()) {
      try {
        // XREAD [COUNT count] [BLOCK milliseconds] STREAMS key [key ...] id [id ...]
        const result = (await this.redis!.xread(
          "COUNT",
          state.options.count!,
          "BLOCK",
          state.options.blockMs!,
          "STREAMS",
          state.stream,
          state.lastId
        )) as XReadResult;

        if (!result || result.length === 0) {
          // 超时或无新消息，继续下一次循环
          continue;
        }

        // 解析消息
        for (const [streamName, messages] of result) {
          for (const [messageId, fields] of messages) {
            try {
              const message = this.parseMessage(messageId, fields);
              await state.callback(message);

              // 更新 lastId 为最后处理的消息 ID
              state.lastId = messageId;
            } catch (callbackError) {
              logger.error("[RedisStreams] Callback error", {
                stream: streamName,
                messageId,
                error:
                  callbackError instanceof Error ? callbackError.message : String(callbackError),
              });
            }
          }
        }
      } catch (error) {
        if (!state.active) {
          // 订阅已取消，退出循环
          break;
        }

        logger.error("[RedisStreams] XREAD error, retrying...", {
          stream: state.stream,
          error: error instanceof Error ? error.message : String(error),
        });

        // 等待一段时间后重试
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    logger.info("[RedisStreams] Read loop terminated", { stream: state.stream });
  }

  /**
   * 启动消费循环 (XREADGROUP)
   * @private
   */
  private async startConsumeLoop(state: ConsumerGroupState): Promise<void> {
    while (state.active && this.isAvailable()) {
      try {
        // XREADGROUP GROUP group consumer [COUNT count] [BLOCK milliseconds] STREAMS key [key ...] id [id ...]
        const result = (await this.redis!.xreadgroup(
          "GROUP",
          state.group,
          state.consumer,
          "COUNT",
          state.options.count!,
          "BLOCK",
          state.options.blockMs!,
          "STREAMS",
          state.stream,
          ">" // 只读取未传递的新消息
        )) as XReadGroupResult;

        if (!result || result.length === 0) {
          // 超时或无新消息，继续下一次循环
          continue;
        }

        // 解析消息
        for (const [streamName, messages] of result) {
          for (const [messageId, fields] of messages) {
            try {
              const message = this.parseMessage(messageId, fields);
              await state.callback(message);

              // 自动 ACK
              if (state.options.autoAck) {
                await this.acknowledgeMessages(state.stream, state.group, messageId);
              }
            } catch (callbackError) {
              logger.error("[RedisStreams] Consumer callback error", {
                stream: streamName,
                group: state.group,
                consumer: state.consumer,
                messageId,
                error:
                  callbackError instanceof Error ? callbackError.message : String(callbackError),
              });

              // 如果回调失败，不 ACK，让消息进入 pending list
            }
          }
        }
      } catch (error) {
        if (!state.active) {
          // 消费已停止，退出循环
          break;
        }

        logger.error("[RedisStreams] XREADGROUP error, retrying...", {
          stream: state.stream,
          group: state.group,
          consumer: state.consumer,
          error: error instanceof Error ? error.message : String(error),
        });

        // 等待一段时间后重试
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    logger.info("[RedisStreams] Consume loop terminated", {
      stream: state.stream,
      group: state.group,
      consumer: state.consumer,
    });
  }

  /**
   * 解析 Redis Stream 消息
   * @private
   */
  private parseMessage<T = unknown>(messageId: string, fields: string[]): StreamMessage<T> {
    // fields 格式: [field1, value1, field2, value2, ...]
    const fieldMap = new Map<string, string>();
    for (let i = 0; i < fields.length; i += 2) {
      fieldMap.set(fields[i], fields[i + 1]);
    }

    // 提取数据和时间戳
    const dataStr = fieldMap.get("data") ?? "{}";
    const timestampStr = fieldMap.get("timestamp");

    let data: T;
    try {
      data = JSON.parse(dataStr);
    } catch {
      data = dataStr as T;
    }

    // 从消息 ID 提取时间戳 (格式: milliseconds-sequence)
    const timestamp = timestampStr
      ? parseInt(timestampStr, 10)
      : parseInt(messageId.split("-")[0], 10);

    return {
      id: messageId,
      data,
      timestamp,
    };
  }

  /**
   * 启动自动清理任务
   * @private
   */
  private startAutoTrim(): void {
    if (!this.config.enableAutoTrim) {
      return;
    }

    this.stopAutoTrim(); // 停止旧任务

    this.trimInterval = setInterval(() => {
      // 清理所有已订阅的 Stream
      for (const stream of this.subscriptions.keys()) {
        this.trimStream(stream).catch((error) => {
          logger.error("[RedisStreams] Auto trim error", {
            stream,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }

      // 清理所有消费组的 Stream
      for (const state of this.consumerGroups.values()) {
        this.trimStream(state.stream).catch((error) => {
          logger.error("[RedisStreams] Auto trim error", {
            stream: state.stream,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }, this.config.autoTrimInterval);

    logger.info("[RedisStreams] Auto trim enabled", {
      interval: this.config.autoTrimInterval,
    });
  }

  /**
   * 停止自动清理任务
   * @private
   */
  private stopAutoTrim(): void {
    if (this.trimInterval) {
      clearInterval(this.trimInterval);
      this.trimInterval = null;
      logger.info("[RedisStreams] Auto trim stopped");
    }
  }

  /**
   * 获取客户端状态 (用于监控和调试)
   */
  public getStatus() {
    return {
      connected: this.isConnected,
      subscriptions: Array.from(this.subscriptions.keys()),
      consumerGroups: Array.from(this.consumerGroups.keys()),
      config: this.config,
    };
  }
}

/**
 * 获取 RedisStreamsClient 单例 (工厂函数)
 */
export function getStreamsClient(config?: StreamsClientConfig): RedisStreamsClient {
  return RedisStreamsClient.getInstance(config);
}

/**
 * 导出错误类
 */
export { StreamsError } from "@/types/redis-streams";
