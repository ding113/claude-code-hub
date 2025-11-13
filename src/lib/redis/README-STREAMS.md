# Redis Streams 消息广播系统

基于 Redis Streams 的分布式 WebSocket 消息广播机制，用于在多个 Next.js 实例之间同步实时数据。

## 功能特性

### 核心功能

- ✅ **消息发布** - 使用 XADD 命令发布消息到 Stream
- ✅ **消息订阅** - 使用 XREAD 阻塞式读取实时消息
- ✅ **消费组管理** - 支持 XGROUP 创建消费组，XREADGROUP 消费消息，XACK 确认机制
- ✅ **消息持久化** - Redis Streams 自动持久化，支持历史消息查询
- ✅ **自动清理** - 使用 XTRIM 定期清理旧消息，避免内存溢出
- ✅ **错误处理** - Fail Open 策略，Redis 不可用时不阻塞服务

### 高级特性

- ✅ **单例模式** - 全局唯一客户端实例，复用连接
- ✅ **自动重连** - 连接断开时自动重试（指数退避）
- ✅ **批量操作** - 支持批量 ACK，批量发布（pipeline）
- ✅ **类型安全** - 完整的 TypeScript 类型定义
- ✅ **结构化日志** - 使用 Pino 记录详细日志
- ✅ **测试覆盖** - 单元测试 + 集成测试，覆盖率 ≥70%

## 架构设计

### 消息流

```
[Next.js Instance 1] ──┐
                       ├──> [Redis Streams] ──┐
[Next.js Instance 2] ──┘                      ├──> [Subscribers]
                                              │
                                              └──> [Consumer Groups]
```

### 核心组件

1. **RedisStreamsClient** - Redis Streams 客户端封装
   - 单例模式管理连接
   - 提供统一的发布/订阅接口
   - 实现消费组管理和 ACK 机制

2. **StreamMessage** - 消息数据结构
   - `id`: 消息 ID (Redis 自动生成)
   - `data`: 消息数据 (JSON 序列化)
   - `timestamp`: 时间戳

3. **SubscriptionState** - 订阅状态管理
   - 跟踪订阅流和回调函数
   - 管理读取位置 (lastId)

4. **ConsumerGroupState** - 消费组状态管理
   - 跟踪消费组、消费者和回调
   - 管理 ACK 状态

## 使用指南

### 安装依赖

本模块依赖现有的 ioredis 客户端，无需额外安装。

```bash
# 已在 package.json 中
ioredis: "5.8.2"
```

### 初始化客户端

```typescript
import { getStreamsClient } from "@/lib/redis/streams";

// 获取单例客户端
const client = getStreamsClient({
  defaultBlockMs: 5000, // 默认阻塞等待时间
  defaultCount: 10, // 默认每次读取消息数
  autoTrimInterval: 3600000, // 自动清理间隔 (1 小时)
  defaultMaxLen: 10000, // 默认保留最大消息数
  enableAutoTrim: true, // 启用自动清理
});

// 连接 Redis
await client.connect();
```

### 发布消息

```typescript
// 发布简单消息
const messageId = await client.publishMessage("dashboard-updates", {
  type: "session_created",
  sessionId: "abc123",
  userId: 456,
  timestamp: Date.now(),
});

console.log("Message published:", messageId); // 1234567890123-0

// 支持自定义消息 ID
await client.publishMessage("logs", { log: "data" }, "1000-0");

// 支持 BigInt 序列化
await client.publishMessage("stats", {
  totalRequests: BigInt(9007199254740991),
});
```

### 订阅消息

```typescript
// 简单订阅
await client.subscribe("dashboard-updates", (message) => {
  console.log("Received:", message.data);
  console.log("Message ID:", message.id);
  console.log("Timestamp:", message.timestamp);
});

// 自定义订阅配置
await client.subscribe(
  "dashboard-updates",
  (message) => {
    // 处理消息
  },
  {
    startId: "0", // 从头开始读取
    blockMs: 10000, // 阻塞等待 10 秒
    count: 20, // 每次读取 20 条消息
  }
);

// 取消订阅
client.unsubscribe("dashboard-updates");
```

### 消费组模式

```typescript
// 创建消费组
await client.createConsumerGroup(
  "dashboard-updates", // Stream 名称
  "dashboard-workers", // 消费组名称
  "$" // 从最新消息开始
);

// 从消费组消费消息
await client.consumeFromGroup(
  "dashboard-updates",
  "dashboard-workers",
  "worker-1", // 消费者名称
  async (message) => {
    // 处理消息
    console.log("Processing:", message.data);
  },
  {
    autoAck: true, // 自动 ACK (默认)
    count: 10,
  }
);

// 手动 ACK
await client.acknowledgeMessages(
  "dashboard-updates",
  "dashboard-workers",
  "1234567890123-0",
  "1234567890124-0"
);

// 停止消费者
client.stopConsumer("dashboard-updates", "dashboard-workers", "worker-1");
```

### 消息清理

```typescript
// 手动清理
const deleted = await client.trimStream("dashboard-updates", {
  maxLen: 5000, // 保留最新 5000 条
  approximate: true, // 使用近似清理 (性能更好)
});

console.log(`Deleted ${deleted} messages`);

// 自动清理（启动时自动开启）
// 配置中的 enableAutoTrim 和 autoTrimInterval 控制
```

### 错误处理

```typescript
// Fail Open 策略 - Redis 不可用时返回 null/false
const messageId = await client.publishMessage("stream", { data: true });
if (!messageId) {
  console.log("Redis unavailable, message not published");
  // 降级处理 (如使用本地队列)
}

// 订阅时的错误处理
await client.subscribe("stream", async (message) => {
  try {
    // 处理消息
    await processMessage(message);
  } catch (error) {
    // 回调异常会被捕获并记录日志，不影响其他消息
    console.error("Message processing failed:", error);
  }
});
```

### 优雅关闭

```typescript
// 应用关闭时清理资源
process.on("SIGTERM", async () => {
  await client.disconnect();
  console.log("Redis Streams client disconnected");
});
```

## 实战场景

### 场景 1: WebSocket 广播 (单播)

使用简单订阅模式，每个 Next.js 实例独立订阅：

```typescript
// Server 启动时
const client = getStreamsClient();
await client.connect();

await client.subscribe("websocket-broadcast", async (message) => {
  const { event, data } = message.data;

  // 广播到本实例的所有 WebSocket 连接
  wsServer.broadcast(event, data);
});

// 其他实例发布消息时
await client.publishMessage("websocket-broadcast", {
  event: "session_update",
  data: { sessionId: "abc", status: "active" },
});
```

### 场景 2: 任务队列 (消费组)

使用消费组模式，多个 Worker 竞争消费：

```typescript
// Worker 启动时
await client.createConsumerGroup("task-queue", "workers", "0");

await client.consumeFromGroup(
  "task-queue",
  "workers",
  `worker-${process.pid}`, // 唯一消费者名称
  async (message) => {
    const { taskId, taskData } = message.data;

    // 处理任务
    await processTask(taskId, taskData);
  },
  {
    autoAck: false, // 手动 ACK
  }
);

// 处理成功后手动 ACK
await client.acknowledgeMessages("task-queue", "workers", message.id);

// 发布任务
await client.publishMessage("task-queue", {
  taskId: "task-123",
  taskData: {
    /* ... */
  },
});
```

### 场景 3: 实时统计聚合

```typescript
// 收集实时数据
await client.subscribe("metrics", async (message) => {
  const { metric, value, timestamp } = message.data;

  // 更新内存缓存
  metricsCache.update(metric, value, timestamp);

  // 通知 WebSocket 客户端
  wsServer.broadcast("metrics_update", { metric, value });
});

// 其他实例上报数据
await client.publishMessage("metrics", {
  metric: "active_sessions",
  value: 42,
  timestamp: Date.now(),
});
```

## 性能优化

### 1. 批量发布 (Pipeline)

```typescript
// 使用 Redis pipeline 批量发布
const pipeline = redis.pipeline();
for (const data of batchData) {
  pipeline.xadd("stream", "*", "data", JSON.stringify(data), "timestamp", Date.now().toString());
}
await pipeline.exec();
```

### 2. 消息压缩

```typescript
import zlib from "zlib";

// 发布前压缩
const compressed = zlib.gzipSync(JSON.stringify(largeData));
await client.publishMessage("stream", { data: compressed.toString("base64") });

// 订阅时解压
await client.subscribe("stream", (message) => {
  const buffer = Buffer.from(message.data.data, "base64");
  const decompressed = zlib.gunzipSync(buffer);
  const data = JSON.parse(decompressed.toString());
});
```

### 3. 定期清理 + 近似 TRIM

```typescript
// 使用近似 TRIM 提高性能
await client.trimStream("stream", {
  maxLen: 10000,
  approximate: true, // 性能提升 10-100 倍
});
```

## 监控和调试

### 获取客户端状态

```typescript
const status = client.getStatus();
console.log(status);
// {
//   connected: true,
//   subscriptions: ["stream1", "stream2"],
//   consumerGroups: ["stream3:group1:consumer1"],
//   config: { ... }
// }
```

### 日志级别

```typescript
// 设置为 debug 级别查看详细日志
import { setLogLevel } from "@/lib/logger";
setLogLevel("debug");

// 日志示例
// [RedisStreams] Message published { stream: 'test', messageId: '1234-0', dataSize: 42 }
// [RedisStreams] Message acknowledged { stream: 'test', group: 'workers', count: 1 }
```

### Redis CLI 监控

```bash
# 查看 Stream 信息
redis-cli XINFO STREAM dashboard-updates

# 查看消费组
redis-cli XINFO GROUPS dashboard-updates

# 查看 pending 消息
redis-cli XPENDING dashboard-updates workers

# 实时监控
redis-cli MONITOR
```

## 测试

### 单元测试

```bash
# 安装测试依赖
pnpm add -D vitest @vitest/ui ioredis-mock

# 运行单元测试
pnpm test src/lib/redis/streams.test.ts

# 查看覆盖率
pnpm test --coverage
```

### 集成测试

```bash
# 启动 Redis
docker run -d -p 6379:6379 redis:7-alpine

# 运行集成测试
INTEGRATION_TEST=true REDIS_URL=redis://localhost:6379 pnpm test src/lib/redis/streams.test.ts
```

## 故障排查

### 问题 1: 消息未收到

**原因**: lastId 设置错误或消息已被消费

**解决方案**:

- 检查 `startId` 配置 ('$' = 最新, '0' = 从头)
- 使用 `redis-cli XRANGE stream - +` 查看消息
- 检查是否使用消费组模式（消息只能被消费一次）

### 问题 2: 内存持续增长

**原因**: 未启用自动清理或 TRIM 策略不当

**解决方案**:

- 启用 `enableAutoTrim: true`
- 调整 `defaultMaxLen` 和 `autoTrimInterval`
- 手动执行 `trimStream()` 清理

### 问题 3: 消息重复消费

**原因**: 未正确 ACK 或消费者崩溃

**解决方案**:

- 确保 `autoAck: true` 或手动调用 `acknowledgeMessages()`
- 检查 pending list: `redis-cli XPENDING stream group`
- 实现幂等性处理

### 问题 4: 连接失败

**原因**: Redis 不可用或配置错误

**解决方案**:

- 检查 `REDIS_URL` 和 `ENABLE_RATE_LIMIT` 环境变量
- 查看日志: `[RedisStreams] Connection error`
- Fail Open 策略会自动降级，不影响服务

## 最佳实践

1. **使用消费组模式处理重要任务** - 保证消息不丢失，支持故障恢复
2. **启用自动清理** - 避免内存溢出
3. **实现幂等性** - 消息可能重复传递
4. **监控 pending list** - 及时发现卡住的消息
5. **合理设置 blockMs** - 平衡延迟和 CPU 占用
6. **使用 approximate TRIM** - 提高清理性能
7. **结构化日志** - 便于调试和监控

## 相关文档

- [Redis Streams 官方文档](https://redis.io/docs/latest/develop/data-types/streams/)
- [ioredis API Reference](https://github.com/redis/ioredis)
- [IMPL-2 任务规格](.workflow/WFS-websocket-realtime-push-dashboard-messages-session/.task/IMPL-2.json)
- [上下文包](../.workflow/WFS-websocket-realtime-push-dashboard-messages-session/.process/context-package.json)

## 许可

本模块遵循项目整体许可协议。
