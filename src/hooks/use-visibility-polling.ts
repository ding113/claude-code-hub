"use client";

import { useCallback, useEffect, useRef } from "react";

interface UseVisibilityPollingOptions {
  /**
   * 轮询间隔（毫秒）
   */
  intervalMs: number;
  /**
   * 是否启用轮询
   */
  enabled: boolean;
  /**
   * 页面变为可见时是否立即执行一次回调
   * @default true
   */
  executeOnVisible?: boolean;
}

/**
 * 带 Page Visibility API 的轮询 Hook
 *
 * 功能：
 * - 页面可见时按指定间隔执行轮询
 * - 页面不可见时暂停轮询
 * - 页面重新可见时立即执行一次回调（可配置）
 *
 * @param callback 轮询回调函数
 * @param options 配置选项
 */
export function useVisibilityPolling(
  callback: () => void | Promise<void>,
  options: UseVisibilityPollingOptions
) {
  const { intervalMs, enabled, executeOnVisible = true } = options;
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callbackRef = useRef(callback);

  // 更新回调引用，避免闭包陷阱
  callbackRef.current = callback;

  // 停止轮询
  const stopPolling = useCallback(() => {
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
  }, []);

  // 启动轮询
  const startPolling = useCallback(() => {
    stopPolling();
    intervalIdRef.current = setInterval(() => {
      callbackRef.current();
    }, intervalMs);
  }, [intervalMs, stopPolling]);

  useEffect(() => {
    if (!enabled) {
      stopPolling();
      return;
    }

    // 处理页面可见性变化
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        // 页面重新可见，立即执行一次并启动轮询
        if (executeOnVisible) {
          callbackRef.current();
        }
        startPolling();
      }
    };

    // 初始启动
    if (!document.hidden) {
      startPolling();
    }

    // 监听可见性变化
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, startPolling, stopPolling, executeOnVisible]);

  return {
    /**
     * 手动停止轮询
     */
    stop: stopPolling,
    /**
     * 手动启动轮询
     */
    start: startPolling,
  };
}
