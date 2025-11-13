import type { Server as SocketIOServer, Socket } from "socket.io";
import { logger } from "./logger";
import { validateKey } from "./auth";
import type {
  WebSocketRoom,
  WebSocketMessage,
  SocketUserData,
  WebSocketStats,
} from "@/types/websocket";

/**
 * WebSocket 管理器
 *
 * 核心功能：
 * 1. 连接认证和用户管理
 * 2. 房间管理（dashboard, sessions, logs）
 * 3. 消息广播
 * 4. 连接统计和监控
 */
export class WebSocketManager {
  private io: SocketIOServer;
  private stats: WebSocketStats = {
    totalConnections: 0,
    activeConnections: 0,
    roomCounts: {
      dashboard: 0,
      sessions: 0,
      logs: 0,
    },
    messagesSent: 0,
    messagesReceived: 0,
    lastUpdateAt: Date.now(),
  };

  constructor(io: SocketIOServer) {
    this.io = io;
    this.setupMiddleware();
    this.setupConnectionHandlers();
    this.setupStatsLogging();
  }

  /**
   * 设置认证中间件
   */
  private setupMiddleware(): void {
    this.io.use(async (socket, next) => {
      try {
        // 从 handshake 中提取认证信息
        const token =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.replace("Bearer ", "") ||
          this.extractCookieToken(socket.handshake.headers?.cookie);

        if (!token) {
          logger.warn("WebSocket: Missing authentication token", {
            socketId: socket.id,
            handshake: {
              auth: socket.handshake.auth,
              headers: socket.handshake.headers,
            },
          });
          return next(new Error("Authentication required"));
        }

        // 验证 token
        const session = await validateKey(token);
        if (!session) {
          logger.warn("WebSocket: Invalid token", {
            socketId: socket.id,
            tokenPrefix: token.substring(0, 10),
          });
          return next(new Error("Invalid token"));
        }

        // 将用户信息附加到 socket.data
        const userData: SocketUserData = {
          user: session.user,
          key: session.key,
          connectedAt: Date.now(),
        };
        socket.data = userData;

        logger.info("WebSocket: Authentication successful", {
          socketId: socket.id,
          userId: session.user.id,
          userName: session.user.name,
          role: session.user.role,
        });

        next();
      } catch (error) {
        logger.error("WebSocket: Authentication error", {
          socketId: socket.id,
          error,
        });
        next(new Error("Authentication failed"));
      }
    });
  }

  /**
   * 从 Cookie 字符串中提取 auth-token
   */
  private extractCookieToken(cookieString?: string): string | null {
    if (!cookieString) return null;

    const cookies = cookieString.split(";").reduce(
      (acc, cookie) => {
        const [key, value] = cookie.trim().split("=");
        acc[key] = value;
        return acc;
      },
      {} as Record<string, string>
    );

    return cookies["auth-token"] || null;
  }

  /**
   * 设置连接处理器
   */
  private setupConnectionHandlers(): void {
    this.io.on("connection", (socket: Socket) => {
      const userData = socket.data as SocketUserData;

      // 更新统计
      this.stats.totalConnections++;
      this.stats.activeConnections++;

      logger.info("WebSocket: Client connected", {
        socketId: socket.id,
        userId: userData.user.id,
        userName: userData.user.name,
        role: userData.user.role,
        totalConnections: this.stats.totalConnections,
        activeConnections: this.stats.activeConnections,
      });

      // 根据用户角色自动加入房间
      this.autoJoinRooms(socket, userData);

      // 监听房间加入事件
      socket.on("joinRoom", (room: WebSocketRoom) => {
        this.handleJoinRoom(socket, room, userData);
      });

      // 监听房间离开事件
      socket.on("leaveRoom", (room: WebSocketRoom) => {
        this.handleLeaveRoom(socket, room, userData);
      });

      // 监听断开连接事件
      socket.on("disconnect", (reason: string) => {
        this.handleDisconnect(socket, reason, userData);
      });

      // 监听错误事件
      socket.on("error", (error: Error) => {
        logger.error("WebSocket: Socket error", {
          socketId: socket.id,
          userId: userData.user.id,
          error: error.message,
          stack: error.stack,
        });
      });

      // 监听 ping 事件（心跳检测）
      socket.on("ping", () => {
        logger.trace("WebSocket: Received ping", {
          socketId: socket.id,
          userId: userData.user.id,
        });
      });

      // 监听 pong 事件
      socket.on("pong", () => {
        logger.trace("WebSocket: Received pong", {
          socketId: socket.id,
          userId: userData.user.id,
        });
      });
    });
  }

  /**
   * 根据用户角色自动加入房间
   */
  private autoJoinRooms(socket: Socket, userData: SocketUserData): void {
    const rooms: WebSocketRoom[] = [];

    if (userData.user.role === "admin") {
      // Admin 可以加入所有房间
      rooms.push("dashboard", "sessions", "logs");
    } else {
      // 普通用户只能加入 sessions 房间（查看自己的 session）
      rooms.push("sessions");
    }

    rooms.forEach((room) => {
      socket.join(room);
      this.stats.roomCounts[room]++;

      logger.debug("WebSocket: Auto-joined room", {
        socketId: socket.id,
        userId: userData.user.id,
        room,
        roomSize: this.io.sockets.adapter.rooms.get(room)?.size || 0,
      });
    });
  }

  /**
   * 处理加入房间请求
   */
  private handleJoinRoom(socket: Socket, room: WebSocketRoom, userData: SocketUserData): void {
    // 权限检查
    if (!this.checkRoomPermission(room, userData)) {
      logger.warn("WebSocket: Permission denied to join room", {
        socketId: socket.id,
        userId: userData.user.id,
        role: userData.user.role,
        room,
      });
      socket.emit("error", { message: "Permission denied", room });
      return;
    }

    socket.join(room);
    this.stats.roomCounts[room]++;

    logger.info("WebSocket: Joined room", {
      socketId: socket.id,
      userId: userData.user.id,
      room,
      roomSize: this.io.sockets.adapter.rooms.get(room)?.size || 0,
    });

    socket.emit("joinedRoom", { room });
  }

  /**
   * 处理离开房间请求
   */
  private handleLeaveRoom(socket: Socket, room: WebSocketRoom, userData: SocketUserData): void {
    socket.leave(room);
    this.stats.roomCounts[room] = Math.max(0, this.stats.roomCounts[room] - 1);

    logger.info("WebSocket: Left room", {
      socketId: socket.id,
      userId: userData.user.id,
      room,
      roomSize: this.io.sockets.adapter.rooms.get(room)?.size || 0,
    });

    socket.emit("leftRoom", { room });
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(socket: Socket, reason: string, userData: SocketUserData): void {
    // 更新统计
    this.stats.activeConnections = Math.max(0, this.stats.activeConnections - 1);

    // 清理房间计数（socket.io 会自动从房间中移除）
    const rooms = Array.from(socket.rooms).filter((room) => room !== socket.id) as WebSocketRoom[];
    rooms.forEach((room) => {
      this.stats.roomCounts[room] = Math.max(0, this.stats.roomCounts[room] - 1);
    });

    logger.info("WebSocket: Client disconnected", {
      socketId: socket.id,
      userId: userData.user.id,
      reason,
      activeConnections: this.stats.activeConnections,
      rooms,
    });
  }

  /**
   * 检查房间权限
   */
  private checkRoomPermission(room: WebSocketRoom, userData: SocketUserData): boolean {
    // Admin 可以访问所有房间
    if (userData.user.role === "admin") {
      return true;
    }

    // 普通用户只能访问 sessions 房间
    return room === "sessions";
  }

  /**
   * 广播消息到指定房间
   */
  public broadcastToRoom<T>(room: WebSocketRoom, message: WebSocketMessage<T>): void {
    try {
      this.io.to(room).emit(message.type, message.data);
      this.stats.messagesSent++;
      this.stats.lastUpdateAt = Date.now();

      logger.trace("WebSocket: Broadcast message", {
        room,
        eventType: message.type,
        dataSize: JSON.stringify(message.data).length,
        roomSize: this.io.sockets.adapter.rooms.get(room)?.size || 0,
      });
    } catch (error) {
      logger.error("WebSocket: Broadcast error", {
        room,
        eventType: message.type,
        error,
      });
    }
  }

  /**
   * 获取连接统计
   */
  public getStats(): WebSocketStats {
    // 实时更新房间大小
    (["dashboard", "sessions", "logs"] as WebSocketRoom[]).forEach((room) => {
      const roomSize = this.io.sockets.adapter.rooms.get(room)?.size || 0;
      this.stats.roomCounts[room] = roomSize;
    });

    return { ...this.stats };
  }

  /**
   * 设置定期统计日志
   */
  private setupStatsLogging(): void {
    setInterval(
      () => {
        const stats = this.getStats();
        logger.info("WebSocket: Connection stats", stats);
      },
      5 * 60 * 1000
    ); // 每 5 分钟记录一次
  }

  /**
   * 获取 Socket.IO 实例
   */
  public getIO(): SocketIOServer {
    return this.io;
  }

  /**
   * 优雅关闭
   */
  public async close(): Promise<void> {
    logger.info("WebSocket: Closing all connections", {
      activeConnections: this.stats.activeConnections,
    });

    // 通知所有客户端服务器即将关闭
    this.io.emit("system:shutdown", { message: "Server is shutting down" });

    // 等待 1 秒让客户端接收消息
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 关闭所有连接
    this.io.close();

    logger.info("WebSocket: All connections closed");
  }
}
