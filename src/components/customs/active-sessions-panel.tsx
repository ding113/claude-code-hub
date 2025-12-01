"use client";

import type { CurrencyCode } from "@/lib/utils/currency";
import { ActiveSessionsList } from "./active-sessions-list";

/**
 * 活跃 Session 面板
 * 显示最近 5 分钟内的活跃 session 列表（简洁文字+图标形式）
 *
 * 注意：此组件现在是 ActiveSessionsList 的简单包装
 * 保留此组件是为了保持向后兼容性
 */
export function ActiveSessionsPanel({ currencyCode = "USD" }: { currencyCode?: CurrencyCode }) {
  return <ActiveSessionsList currencyCode={currencyCode} showHeader={true} maxHeight="200px" />;
}
