"use client";

import { useEffect, useState } from "react";
import { Database, Table, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DatabaseStatus } from "@/types/database-backup";

export function DatabaseStatusDisplay() {
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/database/status', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '获取状态失败');
      }

      const data: DatabaseStatus = await response.json();
      setStatus(data);
    } catch (err) {
      console.error('Fetch status error:', err);
      setError(err instanceof Error ? err.message : '获取数据库状态失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <div className="flex-1">
          <p className="text-sm font-medium text-destructive">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStatus}>
          重试
        </Button>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* 紧凑的横向状态栏 */}
      <div className="flex items-center gap-6 rounded-lg border border-border bg-muted/30 px-4 py-3">
        {/* 连接状态 */}
        <div className="flex items-center gap-2">
          {status.isAvailable ? (
            <>
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-medium">数据库连接正常</span>
            </>
          ) : (
            <>
              <div className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
              <span className="text-sm font-medium text-orange-500">数据库不可用</span>
            </>
          )}
        </div>

        {/* 分隔符 */}
        {status.isAvailable && (
          <>
            <div className="h-4 w-px bg-border" />

            {/* 数据库大小 */}
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{status.databaseSize}</span>
            </div>

            {/* 分隔符 */}
            <div className="h-4 w-px bg-border" />

            {/* 表数量 */}
            <div className="flex items-center gap-2">
              <Table className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{status.tableCount} 个表</span>
            </div>
          </>
        )}

        {/* 刷新按钮 */}
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchStatus}
          className="ml-auto h-8"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 错误信息 */}
      {status.error && (
        <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">
          {status.error}
        </div>
      )}
    </div>
  );
}
