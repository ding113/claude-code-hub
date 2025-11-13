/**
 * WebSocket 消息类型定义
 */

import type { User } from "./user";
import type { Key } from "./key";

/**
 * WebSocket 房间类型
 */
export type WebSocketRoom = "dashboard" | "sessions" | "logs";

/**
 * WebSocket 消息事件类型
 */
export type WebSocketEventType =
  | "dashboard:update"
  | "sessions:update"
  | "logs:update"
  | "system:notification";

/**
 * WebSocket 消息体
 */
export interface WebSocketMessage<T = unknown> {
  type: WebSocketEventType;
  room: WebSocketRoom;
  data: T;
  timestamp: number;
}

/**
 * Socket 用户数据（存储在 socket.data 中）
 */
export interface SocketUserData {
  user: User;
  key: Key;
  connectedAt: number;
}

/**
 * WebSocket 连接统计
 */
export interface WebSocketStats {
  totalConnections: number;
  activeConnections: number;
  roomCounts: Record<WebSocketRoom, number>;
  messagesSent: number;
  messagesReceived: number;
  lastUpdateAt: number;
}

/**
 * WebSocket 配置
 */
export interface WebSocketConfig {
  enabled: boolean;
  path: string;
  pingInterval: number;
  pingTimeout: number;
  cors: {
    origin: string | string[] | boolean;
    credentials: boolean;
  };
  transports: ("websocket" | "polling")[];
}
