"use client";

import { useState, useRef, useEffect } from "react";
import { Upload, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { ImportProgressEvent } from "@/types/database-backup";

export function DatabaseImport() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [cleanFirst, setCleanFirst] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [progressMessages, setProgressMessages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressContainerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到最新进度
  useEffect(() => {
    if (progressContainerRef.current) {
      progressContainerRef.current.scrollTop = progressContainerRef.current.scrollHeight;
    }
  }, [progressMessages]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.dump')) {
        toast.error('请选择 .dump 格式的备份文件');
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleImportClick = () => {
    if (!selectedFile) {
      toast.error('请先选择备份文件');
      return;
    }
    setShowConfirmDialog(true);
  };

  const handleConfirmImport = async () => {
    if (!selectedFile) return;

    setShowConfirmDialog(false);
    setIsImporting(true);
    setProgressMessages([]);

    try {
      // 构造表单数据
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('cleanFirst', cleanFirst.toString());

      // 调用导入 API（SSE 流式响应，自动携带 cookie）
      const response = await fetch('/api/admin/database/import', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '导入失败');
      }

      // 处理 SSE 流
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data: ImportProgressEvent = JSON.parse(line.slice(6));

              if (data.type === 'progress') {
                setProgressMessages(prev => [...prev, data.message]);
              } else if (data.type === 'complete') {
                setProgressMessages(prev => [...prev, `✅ ${data.message}`]);
                toast.success('数据导入完成！');
              } else if (data.type === 'error') {
                setProgressMessages(prev => [...prev, `❌ ${data.message}`]);
                toast.error('数据导入失败，请查看详细日志');
              }
            } catch (parseError) {
              console.error('Parse SSE error:', parseError);
            }
          }
        }
      }

      // 清空文件选择
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Import error:', error);
      toast.error(error instanceof Error ? error.message : '导入数据库失败');
      setProgressMessages(prev => [
        ...prev,
        `❌ 错误: ${error instanceof Error ? error.message : '未知错误'}`
      ]);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        从备份文件恢复数据库。支持 PostgreSQL custom format (.dump) 格式的备份文件。
      </p>

      {/* 文件选择 */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="backup-file">选择备份文件</Label>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            id="backup-file"
            type="file"
            accept=".dump"
            onChange={handleFileChange}
            disabled={isImporting}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        {selectedFile && (
          <p className="text-xs text-muted-foreground">
            已选择: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
          </p>
        )}
      </div>

      {/* 导入选项 */}
      <div className="flex items-start gap-2">
        <Checkbox
          id="clean-first"
          checked={cleanFirst}
          onCheckedChange={(checked: boolean) => setCleanFirst(checked === true)}
          disabled={isImporting}
        />
        <div className="grid gap-1.5 leading-none">
          <Label
            htmlFor="clean-first"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            清除现有数据（覆盖模式）
          </Label>
          <p className="text-xs text-muted-foreground">
            导入前删除所有现有数据，确保数据库与备份文件完全一致。
            如果不勾选，将尝试合并数据，但可能因主键冲突而失败。
          </p>
        </div>
      </div>

      {/* 导入按钮 */}
      <Button
        onClick={handleImportClick}
        disabled={!selectedFile || isImporting}
        className="w-full sm:w-auto"
      >
        <Upload className="mr-2 h-4 w-4" />
        {isImporting ? '正在导入...' : '导入数据库'}
      </Button>

      {/* 进度显示 */}
      {progressMessages.length > 0 && (
        <div className="mt-2 rounded-md border border-border bg-muted/30 p-3">
          <h3 className="text-sm font-medium mb-2">导入进度</h3>
          <div
            ref={progressContainerRef}
            className="max-h-60 overflow-y-auto rounded bg-background p-2 font-mono text-xs space-y-1"
          >
            {progressMessages.map((message, index) => (
              <div key={index} className="text-muted-foreground">
                {message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 确认对话框 */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-500" />
              确认导入数据库
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                {cleanFirst
                  ? '您选择了「覆盖模式」，这将会删除所有现有数据后导入备份。'
                  : '您选择了「合并模式」，这将尝试在保留现有数据的基础上导入备份。'}
              </p>
              <p className="font-semibold text-foreground">
                {cleanFirst
                  ? '⚠️ 警告：此操作不可逆，所有当前数据将被永久删除！'
                  : '⚠️ 注意：如果存在主键冲突，导入可能会失败。'}
              </p>
              <p>
                备份文件: <span className="font-mono text-xs">{selectedFile?.name}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                建议在执行此操作前，先导出当前数据库作为备份。
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmImport}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              确认导入
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
