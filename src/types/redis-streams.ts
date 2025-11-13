/**
 * Redis Streams Type Definitions
 * 用于 WebSocket 实时推送的 Redis Streams 消息类型
 */

/**
 * Redis Stream 消息 ID 格式 (毫秒时间戳-序列号，如 "1234567890123-0")
 */
export type StreamMessageId = string;

/**
 * Redis Stream 消息数据结构
 */
export interface StreamMessage<T = unknown> {
  /** 消息 ID (Redis 自动生成或用户指定) */
  id: StreamMessageId;
  /** 消息数据 (已反序列化) */
  data: T;
  /** 消息发布时间戳 (从消息 ID 提取) */
  timestamp: number;
}

/**
 * Redis XADD 命令返回类型
 */
export type XAddResult = StreamMessageId | null;

/**
 * Redis XREAD 命令返回的原始数据结构
 * 格式: [[streamName, [[messageId, [field1, value1, field2, value2, ...]]]]]
 */
export type XReadResult = [string, [string, string[]][]][] | null;

/**
 * Redis XREADGROUP 命令返回的原始数据结构 (与 XREAD 格式相同)
 */
export type XReadGroupResult = XReadResult;

/**
 * 消息订阅回调函数类型
 */
export type StreamMessageCallback<T = unknown> = (
  message: StreamMessage<T>
) => void | Promise<void>;

/**
 * 消息订阅配置
 */
export interface SubscribeOptions {
  /** 开始读取的消息 ID ('$' 表示最新消息, '0' 表示从头开始) */
  startId?: StreamMessageId;
  /** 阻塞等待时间 (毫秒, 0 表示永久阻塞) */
  blockMs?: number;
  /** 每次读取的最大消息数 */
  count?: number;
}

/**
 * 消费组订阅配置
 */
export interface ConsumeGroupOptions extends SubscribeOptions {
  /** 消费组名称 */
  group: string;
  /** 消费者名称 */
  consumer: string;
  /** 是否自动 ACK (默认: true) */
  autoAck?: boolean;
}

/**
 * Stream 清理配置
 */
export interface TrimOptions {
  /** 保留的最大消息数 (使用 MAXLEN 策略) */
  maxLen?: number;
  /** 使用近似清理 (MAXLEN ~, 性能更好) */
  approximate?: boolean;
}

/**
 * Redis Streams 客户端配置
 */
export interface StreamsClientConfig {
  /** 默认阻塞等待时间 (毫秒, 默认: 5000) */
  defaultBlockMs?: number;
  /** 默认每次读取的最大消息数 (默认: 10) */
  defaultCount?: number;
  /** 自动清理间隔 (毫秒, 默认: 3600000 即 1 小时) */
  autoTrimInterval?: number;
  /** 默认保留的最大消息数 (默认: 10000) */
  defaultMaxLen?: number;
  /** 是否启用自动清理 (默认: true) */
  enableAutoTrim?: boolean;
}

/**
 * 订阅状态
 */
export interface SubscriptionState {
  /** 流名称 */
  stream: string;
  /** 是否正在订阅 */
  active: boolean;
  /** 当前读取位置 (lastId) */
  lastId: StreamMessageId;
  /** 回调函数 */
  callback: StreamMessageCallback;
  /** 订阅配置 */
  options: SubscribeOptions;
}

/**
 * 消费组订阅状态
 */
export interface ConsumerGroupState {
  /** 流名称 */
  stream: string;
  /** 消费组名称 */
  group: string;
  /** 消费者名称 */
  consumer: string;
  /** 是否正在消费 */
  active: boolean;
  /** 回调函数 */
  callback: StreamMessageCallback;
  /** 订阅配置 */
  options: ConsumeGroupOptions;
}

/**
 * Pending 消息信息
 */
export interface PendingMessage {
  /** 消息 ID */
  id: StreamMessageId;
  /** 消费者名称 */
  consumer: string;
  /** 空闲时间 (毫秒, 自上次传递后经过的时间) */
  idleTime: number;
  /** 传递次数 */
  deliveryCount: number;
}

/**
 * Redis Streams 错误类型
 */
export class StreamsError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "StreamsError";
  }
}
