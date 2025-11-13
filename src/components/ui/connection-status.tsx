"use client";

import * as React from "react";
import { Zap, RefreshCw, Loader2, XCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ConnectionState, ConnectionType } from "@/hooks/use-websocket";

export interface ConnectionStatusProps {
  /**
   * ��接状态
   */
  connectionState: ConnectionState;

  /**
   * 连接类型
   */
  connectionType: ConnectionType;

  /**
   * 错误信息
   */
  error?: Error | null;

  /**
   * 自定义类名
   */
  className?: string;

  /**
   * 是否显示详细信息
   * @default false
   */
  showDetails?: boolean;
}

/**
 * 连接状态指示器组件
 *
 * 显示当前 WebSocket 连接状态：
 * - ⚡ 实时连接（绿色）- WebSocket 已连接
 * - 🔄 轮询模式（黄色）- 降级到轮询
 * - ⏳ 连接中（灰色）- 正在连接
 * - ❌ 已断开（红色）- 连接失败
 */
export function ConnectionStatus({
  connectionState,
  connectionType,
  error,
  className,
  showDetails = false,
}: ConnectionStatusProps) {
  /**
   * 获取状态配置
   */
  const getStatusConfig = () => {
    switch (connectionState) {
      case "connected":
        return {
          icon: Zap,
          label: "实时连接",
          color: "text-green-500",
          bgColor: "bg-green-500/10",
          description: "WebSocket 连接正常，数据实时更新",
        };

      case "fallback":
        return {
          icon: RefreshCw,
          label: "轮询模式",
          color: "text-yellow-500",
          bgColor: "bg-yellow-500/10",
          description: "WebSocket 不可用，已降级到轮询模式（每 3-5 秒更新一次）",
        };

      case "connecting":
        return {
          icon: Loader2,
          label: "连接中...",
          color: "text-muted-foreground",
          bgColor: "bg-muted/50",
          description: "正在建立 WebSocket 连接",
          animate: true,
        };

      case "disconnected":
      default:
        return {
          icon: XCircle,
          label: "已断开",
          color: "text-destructive",
          bgColor: "bg-destructive/10",
          description: error ? `连接失败: ${error.message}` : "WebSocket 未连接",
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  /**
   * Tooltip 内容
   */
  const tooltipContent = (
    <div className="space-y-1">
      <div className="font-medium">{config.label}</div>
      <div className="text-xs text-muted-foreground">{config.description}</div>
      {showDetails && (
        <>
          <div className="border-t border-border/50 my-1" />
          <div className="text-xs space-y-0.5">
            <div>
              <span className="text-muted-foreground">状态: </span>
              <span className="font-mono">{connectionState}</span>
            </div>
            <div>
              <span className="text-muted-foreground">类型: </span>
              <span className="font-mono">{connectionType}</span>
            </div>
            {error && (
              <div className="text-destructive">
                <span className="text-muted-foreground">错误: </span>
                <span className="font-mono text-xs">{error.message}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium",
              config.bgColor,
              className
            )}
          >
            <Icon
              className={cn(
                "h-3.5 w-3.5",
                config.color,
                config.animate && "animate-spin"
              )}
            />
            <span className={config.color}>{config.label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * 简化版连接状态指示器（仅图标）
 */
export function ConnectionStatusIcon({
  connectionState,
  connectionType,
  error,
  className,
}: Pick<ConnectionStatusProps, "connectionState" | "connectionType" | "error" | "className">) {
  const getStatusConfig = () => {
    switch (connectionState) {
      case "connected":
        return {
          icon: Zap,
          color: "text-green-500",
          title: "实时连接 (WebSocket)",
        };

      case "fallback":
        return {
          icon: RefreshCw,
          color: "text-yellow-500",
          title: "轮询模式",
        };

      case "connecting":
        return {
          icon: Loader2,
          color: "text-muted-foreground",
          title: "连接中...",
          animate: true,
        };

      case "disconnected":
      default:
        return {
          icon: XCircle,
          color: "text-destructive",
          title: error ? `已断开: ${error.message}` : "已断开",
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Icon
            className={cn(
              "h-4 w-4",
              config.color,
              config.animate && "animate-spin",
              className
            )}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="text-xs">{config.title}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
