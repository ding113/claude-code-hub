#!/usr/bin/env node

/**
 * Next.js 自定义服务器 with Socket.IO
 *
 * 集成 Socket.IO 到 Next.js 服务器，共享端口（APP_PORT）
 * 支持 WebSocket 实时消息推送功能
 */

import { createServer } from "http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { getEnvConfig } from "./src/lib/config/env.schema";
import { logger } from "./src/lib/logger";
import { WebSocketManager } from "./src/lib/websocket-manager";
import { RedisStreamsIntegration } from "./src/lib/redis-streams-integration";
import type { WebSocketConfig } from "./src/types/websocket";

// 环境配置
const env = getEnvConfig();
const dev = env.NODE_ENV === "development";
const hostname = "0.0.0.0"; // 监听所有网络接口
const port = env.APP_PORT || 23000;

// WebSocket 配置
const wsEnabled = env.ENABLE_WEBSOCKET;
const wsPath = env.WEBSOCKET_PATH || "/socket.io";

// 创建 Next.js 应用
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

/**
 * 创建 WebSocket 配置
 */
function createWebSocketConfig(): WebSocketConfig {
  return {
    enabled: wsEnabled,
    path: wsPath,
    pingInterval: 30000, // 30 秒心跳间隔
    pingTimeout: 5000, // 5 秒心跳超时
    cors: {
      origin: dev ? "*" : false, // 开发环境允许所有来源，生产环境禁用
      credentials: true,
    },
    transports: ["websocket", "polling"], // 支持 WebSocket 和 HTTP long-polling 降级
  };
}

/**
 * 优雅关闭处理
 */
async function gracefulShutdown(
  signal: string,
  server: ReturnType<typeof createServer>,
  wsManager?: WebSocketManager,
  redisStreams?: RedisStreamsIntegration
): Promise<void> {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // 1. 停止接受新连接
  server.close(() => {
    logger.info("HTTP server closed");
  });

  // 2. 停止 Redis Streams 订阅
  if (redisStreams) {
    await redisStreams.stop();
  }

  // 3. 关闭所有 WebSocket 连接
  if (wsManager) {
    await wsManager.close();
  }

  // 4. 等待现有请求完成（最多 10 秒）
  setTimeout(() => {
    logger.warn("Forced shutdown after 10 seconds");
    process.exit(0);
  }, 10000);
}

/**
 * 启动服务器
 */
async function startServer() {
  try {
    logger.info("Preparing Next.js application...");
    await app.prepare();

    // 创建 HTTP 服务器
    const server = createServer(async (req, res) => {
      try {
        await handler(req, res);
      } catch (err) {
        logger.error("Error handling request", { error: err });
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });

    // 初始化 WebSocket 服务器（如果启用）
    let wsManager: WebSocketManager | undefined;
    let redisStreams: RedisStreamsIntegration | undefined;

    if (wsEnabled) {
      logger.info("Initializing Socket.IO WebSocket server...");

      const wsConfig = createWebSocketConfig();

      // 创建 Socket.IO 实例
      const io = new SocketIOServer(server, {
        path: wsConfig.path,
        cors: wsConfig.cors,
        transports: wsConfig.transports,
        pingInterval: wsConfig.pingInterval,
        pingTimeout: wsConfig.pingTimeout,
        // 连接超时配置
        connectTimeout: 45000, // 45 秒连接超时
        // 升级超时配置
        upgradeTimeout: 10000, // 10 秒升级超时
        // 最大 HTTP 缓冲大小（10MB）
        maxHttpBufferSize: 10 * 1024 * 1024,
        // 允许的最大升级数
        perMessageDeflate: false, // 禁用压缩以提高性能
      });

      // 创建 WebSocket 管理器
      wsManager = new WebSocketManager(io);

      // 创建 Redis Streams 集成（占位符，待 IMPL-2 完成）
      redisStreams = new RedisStreamsIntegration(io);
      await redisStreams.start();

      logger.info("Socket.IO WebSocket server initialized", {
        path: wsConfig.path,
        pingInterval: wsConfig.pingInterval,
        pingTimeout: wsConfig.pingTimeout,
        transports: wsConfig.transports,
      });
    } else {
      logger.info("WebSocket server disabled (ENABLE_WEBSOCKET=false)");
    }

    // 启动 HTTP 服务器
    await new Promise<void>((resolve, reject) => {
      server.listen(port, hostname, () => {
        resolve();
      });

      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          logger.error(`Port ${port} is already in use`);
        } else {
          logger.error("Server error", { error: err });
        }
        reject(err);
      });
    });

    logger.info(`Server is ready`, {
      hostname,
      port,
      url: `http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}`,
      websocketEnabled: wsEnabled,
      websocketPath: wsEnabled ? wsPath : undefined,
      environment: env.NODE_ENV,
    });

    if (wsEnabled) {
      logger.info(
        `WebSocket server available at ws://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}${wsPath}`
      );
    }

    // 注册优雅关闭处理器
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM", server, wsManager, redisStreams));
    process.on("SIGINT", () => gracefulShutdown("SIGINT", server, wsManager, redisStreams));
  } catch (error) {
    logger.error("Failed to start server", { error });
    process.exit(1);
  }
}

// 启动服务器
startServer();
