"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { logger } from "@/lib/logger";
import type { WebSocketRoom, WebSocketMessage } from "@/types/websocket";

/**
 * WebSocket 连接状态
 */
export type ConnectionState = "disconnected" | "connecting" | "connected" | "fallback";

/**
 * WebSocket 连接类型
 */
export type ConnectionType = "websocket" | "polling";

/**
 * useWebSocket Hook 返回值
 */
export interface UseWebSocketReturn<T> {
  data: T | null;
  isConnected: boolean;
  connectionState: ConnectionState;
  connectionType: ConnectionType;
  error: Error | null;
}

/**
 * useWebSocket Hook 配置
 */
export interface UseWebSocketOptions {
  /**
   * WebSocket 服务器 URL
   * @default 根据环境自动检测
   */
  url?: string;

  /**
   * Socket.IO 路径
   * @default "/socket.io"
   */
  path?: string;

  /**
   * 认证 token（API Key）
   * 如果不提供，会尝试从 cookie 中获取
   */
  token?: string;

  /**
   * 是否启用 WebSocket
   * @default true
   */
  enabled?: boolean;

  /**
   * 重连策略 - 最大重试次数
   * @default 3
   */
  maxRetries?: number;

  /**
   * 重连策略 - 初始延迟（毫秒）
   * @default 1000
   */
  initialRetryDelay?: number;

  /**
   * 重连策略 - 最大延迟（毫秒）
   * @default 8000
   */
  maxRetryDelay?: number;

  /**
   * 降级到轮询的失败次数阈值
   * @default 3
   */
  fallbackThreshold?: number;

  /**
   * 是否在开发环境输出详细日志
   * @default true in development
   */
  debug?: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_OPTIONS: Required<UseWebSocketOptions> = {
  url: typeof window !== "undefined" ? window.location.origin : "http://localhost:13500",
  path: "/socket.io",
  token: "",
  enabled: true,
  maxRetries: 3,
  initialRetryDelay: 1000,
  maxRetryDelay: 8000,
  fallbackThreshold: 3,
  debug: process.env.NODE_ENV === "development",
};

/**
 * useWebSocket Hook
 *
 * 封装 socket.io-client，提供自动重连、降级到轮询等功能
 *
 * @param room - WebSocket 房间名称
 * @param eventName - 监听的事件名称
 * @param options - 配置选项
 *
 * @example
 * ```tsx
 * const { data, isConnected, connectionType } = useWebSocket<OverviewData>(
 *   'dashboard',
 *   'overview-update'
 * );
 * ```
 */
export function useWebSocket<T = unknown>(
  room: WebSocketRoom,
  eventName: string,
  options: UseWebSocketOptions = {}
): UseWebSocketReturn<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const [data, setData] = useState<T | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [connectionType, setConnectionType] = useState<ConnectionType>("websocket");
  const [error, setError] = useState<Error | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  /**
   * 获取认证 token
   */
  const getAuthToken = useCallback((): string | undefined => {
    if (opts.token) {
      return opts.token;
    }

    // 尝试从 cookie 中获取 token
    if (typeof document !== "undefined") {
      const cookies = document.cookie.split(";");
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split("=");
        if (name === "auth_token" || name === "token") {
          return value;
        }
      }
    }

    return undefined;
  }, [opts.token]);

  /**
   * 计算重连延迟（指数退避）
   */
  const getRetryDelay = useCallback(
    (retryCount: number): number => {
      const delay = Math.min(opts.initialRetryDelay * Math.pow(2, retryCount), opts.maxRetryDelay);
      return delay;
    },
    [opts.initialRetryDelay, opts.maxRetryDelay]
  );

  /**
   * 日志输出
   */
  const log = useCallback(
    (level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) => {
      if (!opts.debug) return;

      const logData = {
        hook: "useWebSocket",
        room,
        eventName,
        ...(meta ?? {}),
      };

      if (level === "info") {
        logger.info(message, logData);
      } else if (level === "warn") {
        logger.warn(message, logData);
      } else {
        logger.error(message, logData);
      }
    },
    [opts.debug, room, eventName]
  );

  /**
   * 连接 WebSocket
   */
  const connect = useCallback(() => {
    if (!mountedRef.current || !opts.enabled) {
      return;
    }

    // 检查是否已降级到轮询
    if (retryCountRef.current >= opts.fallbackThreshold) {
      log("warn", "WebSocket: Max retries reached, falling back to polling", {
        retryCount: retryCountRef.current,
        fallbackThreshold: opts.fallbackThreshold,
      });
      setConnectionState("fallback");
      setConnectionType("polling");
      return;
    }

    setConnectionState("connecting");
    setError(null);

    const token = getAuthToken();
    if (!token) {
      log("error", "WebSocket: No authentication token available");
      setError(new Error("No authentication token"));
      setConnectionState("fallback");
      setConnectionType("polling");
      return;
    }

    log("info", "WebSocket: Connecting...", {
      url: opts.url,
      path: opts.path,
      retryCount: retryCountRef.current,
    });

    try {
      const socket = io(opts.url, {
        path: opts.path,
        auth: { token },
        transports: ["websocket", "polling"],
        reconnection: false, // 手动控制重连
        timeout: 5000,
      });

      socketRef.current = socket;

      // 连接成功
      socket.on("connect", () => {
        if (!mountedRef.current) return;

        log("info", "WebSocket: Connected successfully", {
          socketId: socket.id,
          transport: socket.io.engine.transport.name,
        });

        setConnectionState("connected");
        setConnectionType("websocket");
        setError(null);
        retryCountRef.current = 0; // 重置重试计数

        // 加入房间
        socket.emit("join-room", room);
        log("info", `WebSocket: Joined room '${room}'`);
      });

      // 监听数据更新事件
      socket.on(eventName, (message: WebSocketMessage<T>) => {
        if (!mountedRef.current) return;

        log("info", `WebSocket: Received '${eventName}' event`, {
          messageType: message.type,
        });

        setData(message.data);
      });

      // 连接错误
      socket.on("connect_error", (err) => {
        if (!mountedRef.current) return;

        log("error", "WebSocket: Connection error", {
          error: err.message,
          retryCount: retryCountRef.current,
        });

        setError(err);

        // 清理当前连接
        socket.disconnect();
        socketRef.current = null;

        // 尝试重连
        retryCountRef.current += 1;

        if (retryCountRef.current < opts.fallbackThreshold) {
          const delay = getRetryDelay(retryCountRef.current);
          log("info", `WebSocket: Retrying in ${delay}ms...`, {
            retryCount: retryCountRef.current,
            maxRetries: opts.fallbackThreshold,
          });

          retryTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connect();
            }
          }, delay);
        } else {
          log("warn", "WebSocket: Max retries exceeded, falling back to polling");
          setConnectionState("fallback");
          setConnectionType("polling");
        }
      });

      // 断开连接
      socket.on("disconnect", (reason) => {
        if (!mountedRef.current) return;

        log("warn", "WebSocket: Disconnected", { reason });

        setConnectionState("disconnected");

        // 如果是服务器主动断开，尝试重连
        if (reason === "io server disconnect" || reason === "transport close") {
          retryCountRef.current += 1;
          if (retryCountRef.current < opts.fallbackThreshold) {
            const delay = getRetryDelay(retryCountRef.current);
            retryTimeoutRef.current = setTimeout(() => {
              if (mountedRef.current) {
                connect();
              }
            }, delay);
          } else {
            setConnectionState("fallback");
            setConnectionType("polling");
          }
        }
      });
    } catch (err) {
      log("error", "WebSocket: Failed to create socket", { error: err });
      setError(err instanceof Error ? err : new Error("Failed to create socket"));
      setConnectionState("fallback");
      setConnectionType("polling");
    }
  }, [
    opts.enabled,
    opts.url,
    opts.path,
    opts.fallbackThreshold,
    room,
    eventName,
    getAuthToken,
    getRetryDelay,
    log,
  ]);

  /**
   * 断开连接
   */
  const disconnect = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (socketRef.current) {
      log("info", "WebSocket: Disconnecting...");
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    setConnectionState("disconnected");
  }, [log]);

  /**
   * 组件挂载时连接，卸载时断开
   */
  useEffect(() => {
    mountedRef.current = true;

    if (opts.enabled) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [opts.enabled, connect, disconnect]);

  return {
    data,
    isConnected: connectionState === "connected",
    connectionState,
    connectionType,
    error,
  };
}
