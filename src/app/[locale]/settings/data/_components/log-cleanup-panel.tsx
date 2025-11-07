"use client";

import { useState, useEffect, useCallback } from "react";
import { Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export function LogCleanupPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<string>("30");
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const fetchPreview = useCallback(async () => {
    setIsPreviewLoading(true);

    try {
      const beforeDate = new Date();
      beforeDate.setDate(beforeDate.getDate() - parseInt(timeRange));

      const response = await fetch('/api/admin/log-cleanup/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          beforeDate: beforeDate.toISOString(),
          dryRun: true,
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setPreviewCount(result.totalDeleted);
      } else {
        console.error('Preview error:', result.error);
        setPreviewCount(null);
      }
    } catch (error) {
      console.error('Preview error:', error);
      setPreviewCount(null);
    } finally {
      setIsPreviewLoading(false);
    }
  }, [timeRange]);

  // 当对话框打开时，自动预览
  useEffect(() => {
    if (isOpen) {
      fetchPreview();
    } else {
      setPreviewCount(null);
    }
  }, [isOpen, fetchPreview]);

  const handleCleanup = async () => {
    setIsLoading(true);

    try {
      const beforeDate = new Date();
      beforeDate.setDate(beforeDate.getDate() - parseInt(timeRange));

      const response = await fetch('/api/admin/log-cleanup/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          beforeDate: beforeDate.toISOString(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || '清理失败');
      }

      if (result.success) {
        toast.success(`成功清理 ${result.totalDeleted.toLocaleString()} 条日志记录（${result.batchCount} 批次，耗时 ${(result.durationMs / 1000).toFixed(2)}s）`);
        setIsOpen(false);
      } else {
        toast.error(result.error || '清理失败');
      }
    } catch (error) {
      console.error('Cleanup error:', error);
      toast.error(error instanceof Error ? error.message : '清理日志失败');
    } finally {
      setIsLoading(false);
    }
  };

  const getTimeRangeDescription = () => {
    const days = parseInt(timeRange);
    if (days === 7) return '一周前';
    if (days === 30) return '一个月前';
    if (days === 90) return '三个月前';
    if (days === 180) return '六个月前';
    return `${days} 天前`;
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        清理历史日志数据以释放数据库存储空间。
        <strong>注意：统计数据将被保留，但日志详情将被永久删除。</strong>
      </p>

      <div className="flex flex-col gap-3">
        <Label htmlFor="time-range">清理范围</Label>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger id="time-range" className="w-full sm:w-[300px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">一周前的日志 (7 天)</SelectItem>
            <SelectItem value="30">一个月前的日志 (30 天)</SelectItem>
            <SelectItem value="90">三个月前的日志 (90 天)</SelectItem>
            <SelectItem value="180">六个月前的日志 (180 天)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          将清理 {getTimeRangeDescription()} 的所有日志记录
        </p>
      </div>

      <Button
        onClick={() => setIsOpen(true)}
        variant="destructive"
        className="w-full sm:w-auto"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        清理日志
      </Button>

      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              确认清理日志
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                此操作将<strong className="text-destructive">永久删除</strong>{" "}
                {getTimeRangeDescription()}的所有日志记录，
                且<strong className="text-destructive">无法恢复</strong>。
              </p>

              {/* 预览信息 */}
              <div className="bg-muted p-3 rounded-md">
                {isPreviewLoading ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>正在统计...</span>
                  </div>
                ) : previewCount !== null ? (
                  <p className="text-sm font-medium">
                    将删除 <span className="text-destructive text-lg">{previewCount.toLocaleString()}</span> 条日志记录
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    无法获取预览信息
                  </p>
                )}
              </div>

              <p className="text-sm">
                ✓ 统计数据将被保留（用于趋势分析）<br />
                ✗ 日志详情将被删除（请求/响应内容、错误信息等）
              </p>
              <p className="text-sm text-muted-foreground">
                建议：在清理前先<strong>导出数据库备份</strong>，以防需要恢复数据。
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleCleanup();
              }}
              disabled={isLoading || isPreviewLoading}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  正在清理...
                </>
              ) : (
                '确认清理'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
