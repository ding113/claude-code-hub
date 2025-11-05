"use client";

import { useState, useTransition } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { saveSystemSettings } from "@/actions/system-config";
import { toast } from "sonner";

interface ClientVersionToggleProps {
  enabled: boolean;
}

export function ClientVersionToggle({ enabled }: ClientVersionToggleProps) {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [isPending, startTransition] = useTransition();

  async function handleToggle(checked: boolean) {
    startTransition(async () => {
      const result = await saveSystemSettings({
        enableClientVersionCheck: checked,
      });

      if (result.ok) {
        setIsEnabled(checked);
        toast.success(checked ? "已启用客户端版本检查" : "已关闭客户端版本检查");
      } else {
        toast.error(result.error || "更新失败");
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* 开关 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label htmlFor="enable-version-check">启用升级提醒</Label>
          <p className="text-sm text-muted-foreground">启用后，系统将拦截使用旧版本客户端的请求</p>
        </div>
        <Switch
          id="enable-version-check"
          checked={isEnabled}
          onCheckedChange={handleToggle}
          disabled={isPending}
        />
      </div>

      {/* 详细说明 */}
      <Alert variant={isEnabled ? "destructive" : "default"}>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>功能说明</AlertTitle>
        <AlertDescription className="space-y-3">
          <div>
            <strong>启用后会发生什么：</strong>
          </div>
          <ul className="list-inside list-disc space-y-1">
            <li>系统会自动检测每种客户端的最新稳定版本（GA 版本）</li>
            <li>
              <strong>判定规则：</strong>当某个版本被 2 个以上用户使用时，视为 GA 版本
            </li>
            <li>
              <strong>活跃窗口：</strong>仅统计过去 7 天内有请求的用户
            </li>
            <li className={isEnabled ? "text-destructive font-semibold" : ""}>
              使用旧版本的用户将收到 HTTP 400 错误，无法继续使用服务
            </li>
            <li>错误提示中包含当前版本和需要升级的版本号</li>
          </ul>

          <div className="mt-3 pt-3 border-t">
            <strong>推荐做法：</strong>
            <span className="ml-2">先观察下方的版本分布，确认新版本稳定后再启用。</span>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
