"use client";

import { useState, useTransition, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LOG_LEVELS: { value: LogLevel; label: string; description: string }[] = [
  { value: 'fatal', label: 'Fatal', description: '仅致命错误' },
  { value: 'error', label: 'Error', description: '错误信息' },
  { value: 'warn', label: 'Warn', description: '警告 + 错误' },
  { value: 'info', label: 'Info', description: '关键业务事件 + 警告 + 错误（推荐生产）' },
  { value: 'debug', label: 'Debug', description: '调试信息 + 所有级别（推荐开发）' },
  { value: 'trace', label: 'Trace', description: '极详细追踪 + 所有级别' },
];

export function LogLevelForm() {
  const [currentLevel, setCurrentLevel] = useState<LogLevel>('info');
  const [selectedLevel, setSelectedLevel] = useState<LogLevel>('info');
  const [isPending, startTransition] = useTransition();

  // 获取当前日志级别
  useEffect(() => {
    fetch('/api/admin/log-level')
      .then((res) => res.json())
      .then((data) => {
        setCurrentLevel(data.level);
        setSelectedLevel(data.level);
      })
      .catch(() => {
        toast.error('获取日志级别失败');
      });
  }, []);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      try {
        const response = await fetch('/api/admin/log-level', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level: selectedLevel }),
        });

        const result = await response.json();

        if (!response.ok) {
          toast.error(result.error || '设置失败');
          return;
        }

        setCurrentLevel(selectedLevel);
        toast.success(`日志级别已设置为: ${selectedLevel.toUpperCase()}`);
      } catch {
        toast.error('设置日志级别失败');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="log-level">当前日志级别</Label>
        <Select value={selectedLevel} onValueChange={(value) => setSelectedLevel(value as LogLevel)}>
          <SelectTrigger id="log-level" disabled={isPending}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOG_LEVELS.map((level) => (
              <SelectItem key={level.value} value={level.value}>
                <div className="flex flex-col">
                  <span className="font-medium">{level.label}</span>
                  <span className="text-xs text-muted-foreground">{level.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          调整日志级别后立即生效，无需重启服务。
        </p>
      </div>

      <div className="rounded-lg border border-dashed border-border px-4 py-3 space-y-2">
        <h4 className="text-sm font-medium">日志级别说明</h4>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li><strong>Fatal/Error</strong>: 仅显示错误，日志最少，适合高负载生产环境</li>
          <li><strong>Warn</strong>: 包含警告（限流触发、熔断器打开等）+ 错误</li>
          <li><strong>Info（推荐生产）</strong>: 显示关键业务事件（供应商选择、Session 复用、价格同步）+ 警告 + 错误</li>
          <li><strong>Debug（推荐开发）</strong>: 包含详细调试信息，适合排查问题时使用</li>
          <li><strong>Trace</strong>: 极详细的追踪信息，包含所有细节</li>
        </ul>
      </div>

      {selectedLevel !== currentLevel && (
        <div className="rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 px-4 py-3">
          <p className="text-sm text-orange-800 dark:text-orange-200">
            当前级别为 <strong>{currentLevel.toUpperCase()}</strong>，点击保存后将切换到 <strong>{selectedLevel.toUpperCase()}</strong>
          </p>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending || selectedLevel === currentLevel}>
          {isPending ? "保存中..." : "保存设置"}
        </Button>
      </div>
    </form>
  );
}
