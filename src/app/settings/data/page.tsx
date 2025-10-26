"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Section } from "@/components/section";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { DatabaseStatusDisplay } from "./_components/database-status";
import { DatabaseExport } from "./_components/database-export";
import { DatabaseImport } from "./_components/database-import";
import { LogCleanupPanel } from "./_components/log-cleanup-panel";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";

export default function SettingsDataPage() {
  const [isUsageGuideOpen, setIsUsageGuideOpen] = useState(false);

  return (
    <>
      <SettingsPageHeader
        title="数据管理"
        description="管理数据库的备份与恢复，支持完整数据导入导出和日志清理。"
      />

      <Section
        title="数据库状态"
        description="查看当前数据库的连接状态和基本信息。"
      >
        <DatabaseStatusDisplay />
      </Section>

      <Section
        title="日志清理"
        description="清理历史日志数据以释放数据库存储空间，统计数据将被保留。"
      >
        <LogCleanupPanel />
      </Section>

      <Section
        title="数据导出"
        description="将数据库导出为备份文件，用于数据迁移或灾难恢复。"
      >
        <DatabaseExport />
      </Section>

      <Section
        title="数据导入"
        description="从备份文件恢复数据库，支持覆盖和合并两种模式。"
      >
        <DatabaseImport />
      </Section>

      {/* 折叠式使用说明 */}
      <div className="bg-card text-card-foreground border border-border rounded-xl shadow-sm p-5">
        <Collapsible open={isUsageGuideOpen} onOpenChange={setIsUsageGuideOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="flex w-full items-center justify-between p-0 hover:bg-transparent"
            >
              <div className="flex items-center gap-2">
                {isUsageGuideOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <h3 className="text-base font-semibold">使用说明与注意事项</h3>
              </div>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>
                  <strong>日志清理</strong>: 物理删除历史日志数据，不可恢复。
                  统计数据（statistics 表）将被保留。建议清理前先导出数据库备份。
                </li>
                <li>
                  <strong>备份格式</strong>: 使用 PostgreSQL custom format (.dump)，
                  自动压缩且能够兼容不同版本的数据库结构。
                </li>
                <li>
                  <strong>覆盖模式</strong>: 导入前会删除所有现有数据，确保数据库与备份文件完全一致。
                  适合完整恢复场景。
                </li>
                <li>
                  <strong>合并模式</strong>: 保留现有数据，尝试插入备份中的数据。
                  如果存在主键冲突可能导致导入失败。
                </li>
                <li>
                  <strong>安全建议</strong>: 在执行导入操作前，建议先导出当前数据库作为备份，
                  避免数据丢失。
                </li>
                <li>
                  <strong>环境要求</strong>: 此功能需要 Docker Compose 部署环境。
                  本地开发环境可能无法使用。
                </li>
              </ul>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </>
  );
}
