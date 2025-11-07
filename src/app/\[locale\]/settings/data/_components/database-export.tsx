"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function DatabaseExport() {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);

    try {
      // 调用导出 API（自动携带 cookie）
      const response = await fetch('/api/admin/database/export', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '导出失败');
      }

      // 获取文件名（从 Content-Disposition header）
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || `backup_${new Date().toISOString()}.dump`;

      // 下载文件
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success('数据库导出成功！');
    } catch (error) {
      console.error('Export error:', error);
      toast.error(error instanceof Error ? error.message : '导出数据库失败');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        导出完整的数据库备份文件（.dump 格式），可用于数据迁移或恢复。
        备份文件使用 PostgreSQL custom format，自动压缩且兼容不同版本的数据库结构。
      </p>

      <Button
        onClick={handleExport}
        disabled={isExporting}
        className="w-full sm:w-auto"
      >
        <Download className="mr-2 h-4 w-4" />
        {isExporting ? '正在导出...' : '导出数据库'}
      </Button>
    </div>
  );
}
