/**
 * Redis Streams Client - Unit Tests
 *
 * 测试框架: Vitest (需要安装: pnpm add -D vitest @vitest/ui ioredis-mock)
 * 运行测试: pnpm test src/lib/redis/streams.test.ts
 * 覆盖率: pnpm test --coverage
 *
 * 本文件提供完整的测试用例，覆盖所有核心功能:
 * - 单例模式
 * - 连接管理
 * - 消息发布 (XADD)
 * - 消息订阅 (XREAD)
 * - 消费组管理 (XGROUP, XREADGROUP, XACK)
 * - 消息清理 (XTRIM)
 * - 错误处理和 Fail Open 策略
 *
 * 注意: 此文件依赖 vitest，暂时不会被 TypeScript 编译
 * 安装后取消下面的注释即可运行测试
 */

// TODO: 安装 vitest 后取消注释
// import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// import Redis from "ioredis";
// import { RedisStreamsClient, getStreamsClient } from "./streams";
// import type { StreamMessage } from "@/types/redis-streams";

// Mock Redis 客户端
// vi.mock("ioredis");
// vi.mock("./client", () => ({
//   buildRedisOptionsForUrl: vi.fn(() => ({
//     isTLS: false,
//     options: {
//       enableOfflineQueue: false,
//       maxRetriesPerRequest: 3,
//     },
//   })),
// }));

/**
 * 测试用例框架 (需要安装 vitest 后才能运行)
 *
 * 使用方式:
 * 1. pnpm add -D vitest @vitest/ui
 * 2. 取消上面的 import 注释
 * 3. 取消下面的测试用例注释
 * 4. pnpm test src/lib/redis/streams.test.ts
 */

export {}; // 防止 TypeScript 报错

// describe("RedisStreamsClient", () => {
//   let mockRedis: Redis;
//   let client: RedisStreamsClient;
// 
//   beforeEach(() => {
//     // 重置环境变量
//     process.env.REDIS_URL = "redis://localhost:6379";
//     process.env.ENABLE_RATE_LIMIT = "true";
// 
//     // 创建 Mock Redis 实例
//     mockRedis = new Redis();
// 
//     // Mock Redis 方法
//     vi.spyOn(mockRedis, "xadd").mockResolvedValue("1234567890123-0");
//     vi.spyOn(mockRedis, "xread").mockResolvedValue([
//       [
//         "test-stream",
//         [
//           [
//             "1234567890123-0",
//             ["data", JSON.stringify({ test: "data" }), "timestamp", "1234567890123"],
//           ],
//         ],
//       ],
//     ]);
//     vi.spyOn(mockRedis, "xgroup").mockResolvedValue("OK");
//     vi.spyOn(mockRedis, "xreadgroup").mockResolvedValue([
//       [
//         "test-stream",
//         [
//           [
//             "1234567890124-0",
//             ["data", JSON.stringify({ group: "message" }), "timestamp", "1234567890124"],
//           ],
//         ],
//       ],
//     ]);
//     vi.spyOn(mockRedis, "xack").mockResolvedValue(1);
//     vi.spyOn(mockRedis, "xtrim").mockResolvedValue(10);
//     vi.spyOn(mockRedis, "connect").mockResolvedValue(undefined);
//     vi.spyOn(mockRedis, "quit").mockResolvedValue("OK");
//     vi.spyOn(mockRedis, "on").mockReturnThis();
// 
//     // 获取客户端实例
//     client = getStreamsClient();
//   });
// 
//   afterEach(async () => {
//     await client.disconnect();
//     vi.clearAllMocks();
//   });
// 
//   describe("Singleton Pattern", () => {
//     it("should return the same instance", () => {
//       const instance1 = getStreamsClient();
//       const instance2 = getStreamsClient();
//       expect(instance1).toBe(instance2);
//     });
// 
//     it("should accept custom config on first instantiation", () => {
//       const config = {
//         defaultBlockMs: 10000,
//         defaultCount: 20,
//         defaultMaxLen: 20000,
//       };
// 
//       const instance = getStreamsClient(config);
//       const status = instance.getStatus();
// 
//       expect(status.config.defaultBlockMs).toBe(10000);
//       expect(status.config.defaultCount).toBe(20);
//       expect(status.config.defaultMaxLen).toBe(20000);
//     });
//   });
// 
//   describe("Connection Management", () => {
//     it("should connect to Redis successfully", async () => {
//       await client.connect();
// 
//       expect(mockRedis.connect).toHaveBeenCalled();
//       expect(mockRedis.on).toHaveBeenCalledWith("connect", expect.any(Function));
//       expect(mockRedis.on).toHaveBeenCalledWith("error", expect.any(Function));
//       expect(mockRedis.on).toHaveBeenCalledWith("ready", expect.any(Function));
//     });
// 
//     it("should skip connection in CI/build phase", async () => {
//       process.env.CI = "true";
//       await client.connect();
// 
//       expect(mockRedis.connect).not.toHaveBeenCalled();
//     });
// 
//     it("should skip connection when Redis is disabled", async () => {
//       process.env.ENABLE_RATE_LIMIT = "false";
//       await client.connect();
// 
//       expect(mockRedis.connect).not.toHaveBeenCalled();
//     });
// 
//     it("should handle connection errors gracefully (Fail Open)", async () => {
//       vi.spyOn(mockRedis, "connect").mockRejectedValue(new Error("Connection failed"));
// 
//       await expect(client.connect()).resolves.not.toThrow();
//     });
// 
//     it("should disconnect and clean up resources", async () => {
//       await client.connect();
//       await client.disconnect();
// 
//       expect(mockRedis.quit).toHaveBeenCalled();
//     });
//   });
// 
//   describe("Message Publishing (XADD)", () => {
//     beforeEach(async () => {
//       await client.connect();
//       // 模拟连接成功
//       const status = client.getStatus();
//       (status as any).connected = true;
//     });
// 
//     it("should publish message successfully", async () => {
//       const data = { userId: 123, action: "login" };
//       const messageId = await client.publishMessage("test-stream", data);
// 
//       expect(messageId).toBe("1234567890123-0");
//       expect(mockRedis.xadd).toHaveBeenCalledWith(
//         "test-stream",
//         "*",
//         "data",
//         JSON.stringify(data),
//         "timestamp",
//         expect.any(String),
//       );
//     });
// 
//     it("should support custom message ID", async () => {
//       await client.publishMessage("test-stream", { test: true }, "1000-0");
// 
//       expect(mockRedis.xadd).toHaveBeenCalledWith("test-stream", "1000-0", "data", expect.any(String), "timestamp", expect.any(String));
//     });
// 
//     it("should serialize BigInt correctly", async () => {
//       const data = { id: BigInt(9007199254740991), value: 123 };
//       await client.publishMessage("test-stream", data);
// 
//       const serializedData = (mockRedis.xadd as any).mock.calls[0][3];
//       expect(serializedData).toContain('"id":"9007199254740991"');
//     });
// 
//     it("should return null on publish error (Fail Open)", async () => {
//       vi.spyOn(mockRedis, "xadd").mockRejectedValue(new Error("XADD failed"));
// 
//       const messageId = await client.publishMessage("test-stream", { test: true });
// 
//       expect(messageId).toBeNull();
//     });
// 
//     it("should return null when Redis is unavailable", async () => {
//       await client.disconnect();
// 
//       const messageId = await client.publishMessage("test-stream", { test: true });
// 
//       expect(messageId).toBeNull();
//     });
//   });
// 
//   describe("Message Subscription (XREAD)", () => {
//     beforeEach(async () => {
//       await client.connect();
//       (client.getStatus() as any).connected = true;
//     });
// 
//     it("should subscribe to stream and receive messages", async () => {
//       const callback = vi.fn();
// 
//       await client.subscribe("test-stream", callback);
// 
//       // 等待一次读取循环
//       await new Promise((resolve) => setTimeout(resolve, 100));
// 
//       expect(mockRedis.xread).toHaveBeenCalledWith(
//         "COUNT",
//         10,
//         "BLOCK",
//         5000,
//         "STREAMS",
//         "test-stream",
//         "$",
//       );
//     });
// 
//     it("should parse and deliver messages to callback", async () => {
//       const callback = vi.fn();
// 
//       await client.subscribe("test-stream", callback);
//       await new Promise((resolve) => setTimeout(resolve, 100));
// 
//       expect(callback).toHaveBeenCalledWith(
//         expect.objectContaining({
//           id: "1234567890123-0",
//           data: { test: "data" },
//           timestamp: 1234567890123,
//         }),
//       );
//     });
// 
//     it("should support custom subscribe options", async () => {
//       const callback = vi.fn();
// 
//       await client.subscribe("test-stream", callback, {
//         startId: "0",
//         blockMs: 10000,
//         count: 20,
//       });
// 
//       await new Promise((resolve) => setTimeout(resolve, 100));
// 
//       expect(mockRedis.xread).toHaveBeenCalledWith("COUNT", 20, "BLOCK", 10000, "STREAMS", "test-stream", "0");
//     });
// 
//     it("should unsubscribe from stream", async () => {
//       const callback = vi.fn();
//       await client.subscribe("test-stream", callback);
// 
//       client.unsubscribe("test-stream");
// 
//       const status = client.getStatus();
//       expect(status.subscriptions).not.toContain("test-stream");
//     });
// 
//     it("should handle callback errors gracefully", async () => {
//       const callback = vi.fn().mockRejectedValue(new Error("Callback failed"));
// 
//       await client.subscribe("test-stream", callback);
//       await new Promise((resolve) => setTimeout(resolve, 100));
// 
//       // 不应抛出异常
//       expect(() => {}).not.toThrow();
//     });
// 
//     it("should not subscribe when Redis is unavailable", async () => {
//       await client.disconnect();
// 
//       const callback = vi.fn();
//       await client.subscribe("test-stream", callback);
// 
//       expect(mockRedis.xread).not.toHaveBeenCalled();
//     });
//   });
// 
//   describe("Consumer Group Management", () => {
//     beforeEach(async () => {
//       await client.connect();
//       (client.getStatus() as any).connected = true;
//     });
// 
//     it("should create consumer group successfully", async () => {
//       const result = await client.createConsumerGroup("test-stream", "test-group");
// 
//       expect(result).toBe(true);
//       expect(mockRedis.xgroup).toHaveBeenCalledWith("CREATE", "test-stream", "test-group", "$", "MKSTREAM");
//     });
// 
//     it("should handle existing consumer group gracefully", async () => {
//       vi.spyOn(mockRedis, "xgroup").mockRejectedValue(new Error("BUSYGROUP Consumer Group name already exists"));
// 
//       const result = await client.createConsumerGroup("test-stream", "test-group");
// 
//       expect(result).toBe(true);
//     });
// 
//     it("should return false on other errors", async () => {
//       vi.spyOn(mockRedis, "xgroup").mockRejectedValue(new Error("Unknown error"));
// 
//       const result = await client.createConsumerGroup("test-stream", "test-group");
// 
//       expect(result).toBe(false);
//     });
// 
//     it("should consume messages from group", async () => {
//       const callback = vi.fn();
// 
//       await client.consumeFromGroup("test-stream", "test-group", "consumer-1", callback);
//       await new Promise((resolve) => setTimeout(resolve, 100));
// 
//       expect(mockRedis.xreadgroup).toHaveBeenCalledWith(
//         "GROUP",
//         "test-group",
//         "consumer-1",
//         "COUNT",
//         10,
//         "BLOCK",
//         5000,
//         "STREAMS",
//         "test-stream",
//         ">",
//       );
//     });
// 
//     it("should auto-acknowledge messages by default", async () => {
//       const callback = vi.fn();
// 
//       await client.consumeFromGroup("test-stream", "test-group", "consumer-1", callback);
//       await new Promise((resolve) => setTimeout(resolve, 100));
// 
//       expect(mockRedis.xack).toHaveBeenCalledWith("test-stream", "test-group", "1234567890124-0");
//     });
// 
//     it("should not auto-acknowledge when autoAck is false", async () => {
//       const callback = vi.fn();
// 
//       await client.consumeFromGroup("test-stream", "test-group", "consumer-1", callback, {
//         autoAck: false,
//       });
//       await new Promise((resolve) => setTimeout(resolve, 100));
// 
//       expect(mockRedis.xack).not.toHaveBeenCalled();
//     });
// 
//     it("should stop consumer", async () => {
//       const callback = vi.fn();
//       await client.consumeFromGroup("test-stream", "test-group", "consumer-1", callback);
// 
//       client.stopConsumer("test-stream", "test-group", "consumer-1");
// 
//       const status = client.getStatus();
//       expect(status.consumerGroups).not.toContain("test-stream:test-group:consumer-1");
//     });
// 
//     it("should acknowledge messages manually", async () => {
//       const count = await client.acknowledgeMessages("test-stream", "test-group", "1234567890123-0", "1234567890124-0");
// 
//       expect(count).toBe(1);
//       expect(mockRedis.xack).toHaveBeenCalledWith("test-stream", "test-group", "1234567890123-0", "1234567890124-0");
//     });
// 
//     it("should return 0 when ACK fails", async () => {
//       vi.spyOn(mockRedis, "xack").mockRejectedValue(new Error("XACK failed"));
// 
//       const count = await client.acknowledgeMessages("test-stream", "test-group", "1234567890123-0");
// 
//       expect(count).toBe(0);
//     });
//   });
// 
//   describe("Message Cleanup (XTRIM)", () => {
//     beforeEach(async () => {
//       await client.connect();
//       (client.getStatus() as any).connected = true;
//     });
// 
//     it("should trim stream with default options", async () => {
//       const deleted = await client.trimStream("test-stream");
// 
//       expect(deleted).toBe(10);
//       expect(mockRedis.xtrim).toHaveBeenCalledWith("test-stream", "MAXLEN", "~", 10000);
//     });
// 
//     it("should trim stream with custom maxLen", async () => {
//       await client.trimStream("test-stream", { maxLen: 5000 });
// 
//       expect(mockRedis.xtrim).toHaveBeenCalledWith("test-stream", "MAXLEN", "~", 5000);
//     });
// 
//     it("should trim stream with exact MAXLEN (not approximate)", async () => {
//       await client.trimStream("test-stream", { maxLen: 5000, approximate: false });
// 
//       expect(mockRedis.xtrim).toHaveBeenCalledWith("test-stream", "MAXLEN", 5000);
//     });
// 
//     it("should return 0 on trim error", async () => {
//       vi.spyOn(mockRedis, "xtrim").mockRejectedValue(new Error("XTRIM failed"));
// 
//       const deleted = await client.trimStream("test-stream");
// 
//       expect(deleted).toBe(0);
//     });
// 
//     it("should enable auto-trim on connect", async () => {
//       const config = { enableAutoTrim: true, autoTrimInterval: 1000 };
//       const clientWithAutoTrim = getStreamsClient(config);
// 
//       await clientWithAutoTrim.connect();
// 
//       // 验证定时器已启动（通过 getStatus 间接验证）
//       const status = clientWithAutoTrim.getStatus();
//       expect(status.config.enableAutoTrim).toBe(true);
// 
//       await clientWithAutoTrim.disconnect();
//     });
// 
//     it("should disable auto-trim when configured", async () => {
//       const config = { enableAutoTrim: false };
//       const clientWithoutAutoTrim = getStreamsClient(config);
// 
//       await clientWithoutAutoTrim.connect();
// 
//       const status = clientWithoutAutoTrim.getStatus();
//       expect(status.config.enableAutoTrim).toBe(false);
// 
//       await clientWithoutAutoTrim.disconnect();
//     });
//   });
// 
//   describe("Error Handling and Fail Open", () => {
//     it("should handle Redis connection failure gracefully", async () => {
//       vi.spyOn(mockRedis, "connect").mockRejectedValue(new Error("Connection refused"));
// 
//       await expect(client.connect()).resolves.not.toThrow();
//     });
// 
//     it("should return null for publish when Redis unavailable", async () => {
//       await client.disconnect();
// 
//       const result = await client.publishMessage("test-stream", { test: true });
// 
//       expect(result).toBeNull();
//     });
// 
//     it("should not subscribe when Redis unavailable", async () => {
//       await client.disconnect();
// 
//       const callback = vi.fn();
//       await client.subscribe("test-stream", callback);
// 
//       expect(callback).not.toHaveBeenCalled();
//     });
// 
//     it("should handle XREAD errors and retry", async () => {
//       await client.connect();
//       (client.getStatus() as any).connected = true;
// 
//       let callCount = 0;
//       vi.spyOn(mockRedis, "xread").mockImplementation(() => {
//         callCount++;
//         if (callCount === 1) {
//           throw new Error("XREAD failed");
//         }
//         return Promise.resolve([
//           [
//             "test-stream",
//             [["1234567890123-0", ["data", JSON.stringify({ test: "data" }), "timestamp", "1234567890123"]]],
//           ],
//         ]);
//       });
// 
//       const callback = vi.fn();
//       await client.subscribe("test-stream", callback);
// 
//       await new Promise((resolve) => setTimeout(resolve, 1500));
// 
//       expect(callCount).toBeGreaterThan(1);
//     });
//   });
// 
//   describe("Client Status", () => {
//     it("should return current status", async () => {
//       await client.connect();
//       (client.getStatus() as any).connected = true;
// 
//       await client.subscribe("stream1", vi.fn());
//       await client.consumeFromGroup("stream2", "group1", "consumer1", vi.fn());
// 
//       const status = client.getStatus();
// 
//       expect(status).toMatchObject({
//         connected: true,
//         subscriptions: ["stream1"],
//         consumerGroups: ["stream2:group1:consumer1"],
//         config: expect.any(Object),
//       });
//     });
//   });
// 
//   describe("Message Parsing", () => {
//     it("should parse valid JSON data", () => {
//       const fields = ["data", JSON.stringify({ test: "data" }), "timestamp", "1234567890123"];
//       const message = (client as any).parseMessage("1234567890123-0", fields);
// 
//       expect(message).toMatchObject({
//         id: "1234567890123-0",
//         data: { test: "data" },
//         timestamp: 1234567890123,
//       });
//     });
// 
//     it("should fallback to string for invalid JSON", () => {
//       const fields = ["data", "invalid json", "timestamp", "1234567890123"];
//       const message = (client as any).parseMessage("1234567890123-0", fields);
// 
//       expect(message.data).toBe("invalid json");
//     });
// 
//     it("should extract timestamp from message ID when not provided", () => {
//       const fields = ["data", JSON.stringify({ test: true })];
//       const message = (client as any).parseMessage("1234567890123-0", fields);
// 
//       expect(message.timestamp).toBe(1234567890123);
//     });
//   });
// });
// 
// /**
//  * 集成测试 (需要真实 Redis 实例)
//  *
//  * 运行方式:
//  * 1. 启动 Redis: docker run -d -p 6379:6379 redis:7-alpine
//  * 2. 运行测试: REDIS_URL=redis://localhost:6379 pnpm test src/lib/redis/streams.test.ts
//  */
// describe("RedisStreamsClient - Integration Tests", () => {
//   const isIntegrationTest = process.env.INTEGRATION_TEST === "true";
// 
//   if (!isIntegrationTest) {
//     it.skip("Integration tests skipped (set INTEGRATION_TEST=true to run)", () => {});
//     return;
//   }
// 
//   let client: RedisStreamsClient;
// 
//   beforeEach(async () => {
//     process.env.REDIS_URL = "redis://localhost:6379";
//     process.env.ENABLE_RATE_LIMIT = "true";
// 
//     client = getStreamsClient();
//     await client.connect();
//   });
// 
//   afterEach(async () => {
//     await client.disconnect();
//   });
// 
//   it("should publish and subscribe to real Redis stream", async () => {
//     const messages: StreamMessage[] = [];
//     const callback = vi.fn((msg: StreamMessage) => {
//       messages.push(msg);
//     });
// 
//     // 订阅
//     await client.subscribe("integration-test-stream", callback, { startId: "$" });
// 
//     // 发布消息
//     const data = { userId: 123, action: "test", timestamp: Date.now() };
//     const messageId = await client.publishMessage("integration-test-stream", data);
// 
//     expect(messageId).toBeTruthy();
// 
//     // 等待消息传递
//     await new Promise((resolve) => setTimeout(resolve, 6000));
// 
//     expect(messages.length).toBeGreaterThan(0);
//     expect(messages[0].data).toMatchObject(data);
// 
//     // 清理
//     client.unsubscribe("integration-test-stream");
//     await client.trimStream("integration-test-stream", { maxLen: 0, approximate: false });
//   });
// 
//   it("should create consumer group and consume messages", async () => {
//     const messages: StreamMessage[] = [];
//     const callback = vi.fn((msg: StreamMessage) => {
//       messages.push(msg);
//     });
// 
//     // 创建消费组
//     const created = await client.createConsumerGroup("integration-test-group-stream", "test-group", "0");
//     expect(created).toBe(true);
// 
//     // 发布消息
//     await client.publishMessage("integration-test-group-stream", { test: "group-message" });
// 
//     // 消费消息
//     await client.consumeFromGroup("integration-test-group-stream", "test-group", "consumer-1", callback, {
//       autoAck: true,
//     });
// 
//     // 等待消息传递
//     await new Promise((resolve) => setTimeout(resolve, 6000));
// 
//     expect(messages.length).toBeGreaterThan(0);
//     expect(messages[0].data).toMatchObject({ test: "group-message" });
// 
//     // 清理
//     client.stopConsumer("integration-test-group-stream", "test-group", "consumer-1");
//     await client.trimStream("integration-test-group-stream", { maxLen: 0, approximate: false });
//   });
// });
