"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState, useTransition } from "react";
import { addProvider, editProvider, removeProvider } from "@/actions/providers";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader as AlertHeader,
  AlertDialogTitle as AlertTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { ProviderDisplay, ProviderType } from "@/types/provider";
import { validateNumericField, isValidUrl } from "@/lib/utils/validation";
import { PROVIDER_DEFAULTS } from "@/lib/constants/provider.constants";
import { toast } from "sonner";
import { ModelMultiSelect } from "../model-multi-select";
import { ModelRedirectEditor } from "../model-redirect-editor";

type Mode = "create" | "edit";

interface ProviderFormProps {
  mode: Mode;
  onSuccess?: () => void;
  provider?: ProviderDisplay; // edit 模式需要，create 可空
}

export function ProviderForm({ mode, onSuccess, provider }: ProviderFormProps) {
  const isEdit = mode === "edit";
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(isEdit ? (provider?.name ?? "") : "");
  const [url, setUrl] = useState(isEdit ? (provider?.url ?? "") : "");
  const [key, setKey] = useState(""); // 编辑时留空代表不更新
  const [providerType, setProviderType] = useState<ProviderType>(
    isEdit ? (provider?.providerType ?? "claude") : "claude"
  );
  const [modelRedirects, setModelRedirects] = useState<Record<string, string>>(
    isEdit && provider?.modelRedirects ? provider.modelRedirects : {}
  );
  const [priority, setPriority] = useState<number>(isEdit ? (provider?.priority ?? 0) : 0);
  const [weight, setWeight] = useState<number>(isEdit ? (provider?.weight ?? 1) : 1);
  const [costMultiplier, setCostMultiplier] = useState<number>(
    isEdit ? (provider?.costMultiplier ?? 1.0) : 1.0
  );
  const [groupTag, setGroupTag] = useState<string>(isEdit ? (provider?.groupTag ?? "") : "");
  const [limit5hUsd, setLimit5hUsd] = useState<number | null>(
    isEdit ? (provider?.limit5hUsd ?? null) : null
  );
  const [limitWeeklyUsd, setLimitWeeklyUsd] = useState<number | null>(
    isEdit ? (provider?.limitWeeklyUsd ?? null) : null
  );
  const [limitMonthlyUsd, setLimitMonthlyUsd] = useState<number | null>(
    isEdit ? (provider?.limitMonthlyUsd ?? null) : null
  );
  const [limitConcurrentSessions, setLimitConcurrentSessions] = useState<number | null>(
    isEdit ? (provider?.limitConcurrentSessions ?? null) : null
  );
  const [allowedModels, setAllowedModels] = useState<string[]>(
    isEdit && provider?.allowedModels ? provider.allowedModels : []
  );
  const [joinClaudePool, setJoinClaudePool] = useState<boolean>(
    isEdit && provider?.joinClaudePool ? provider.joinClaudePool : false
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !url.trim() || (!isEdit && !key.trim())) {
      return;
    }

    if (!isValidUrl(url.trim())) {
      toast.error("请输入有效的URL地址");
      return;
    }

    // 处理模型重定向（空对象转为 null）
    const parsedModelRedirects = Object.keys(modelRedirects).length > 0 ? modelRedirects : null;

    startTransition(async () => {
      try {
        if (isEdit && provider) {
          const updateData: {
            name?: string;
            url?: string;
            key?: string;
            provider_type?: ProviderType;
            model_redirects?: Record<string, string> | null;
            allowed_models?: string[] | null;
            join_claude_pool?: boolean;
            priority?: number;
            weight?: number;
            cost_multiplier?: number;
            group_tag?: string | null;
            limit_5h_usd?: number | null;
            limit_weekly_usd?: number | null;
            limit_monthly_usd?: number | null;
            limit_concurrent_sessions?: number | null;
            tpm?: number | null;
            rpm?: number | null;
            rpd?: number | null;
            cc?: number | null;
          } = {
            name: name.trim(),
            url: url.trim(),
            provider_type: providerType,
            model_redirects: parsedModelRedirects,
            allowed_models: allowedModels.length > 0 ? allowedModels : null,
            join_claude_pool: joinClaudePool,
            priority: priority,
            weight: weight,
            cost_multiplier: costMultiplier,
            group_tag: groupTag.trim() || null,
            limit_5h_usd: limit5hUsd,
            limit_weekly_usd: limitWeeklyUsd,
            limit_monthly_usd: limitMonthlyUsd,
            limit_concurrent_sessions: limitConcurrentSessions,
            tpm: null,
            rpm: null,
            rpd: null,
            cc: null,
          };
          if (key.trim()) {
            updateData.key = key.trim();
          }
          const res = await editProvider(provider.id, updateData);
          if (!res.ok) {
            toast.error(res.error || "更新服务商失败");
            return;
          }
        } else {
          const res = await addProvider({
            name: name.trim(),
            url: url.trim(),
            key: key.trim(),
            provider_type: providerType,
            model_redirects: parsedModelRedirects,
            allowed_models: allowedModels.length > 0 ? allowedModels : null,
            join_claude_pool: joinClaudePool,
            // 使用配置的默认值：默认不启用、权重=1
            is_enabled: PROVIDER_DEFAULTS.IS_ENABLED,
            weight: weight,
            priority: priority,
            cost_multiplier: costMultiplier,
            group_tag: groupTag.trim() || null,
            limit_5h_usd: limit5hUsd,
            limit_weekly_usd: limitWeeklyUsd,
            limit_monthly_usd: limitMonthlyUsd,
            limit_concurrent_sessions: limitConcurrentSessions ?? 0,
            tpm: null,
            rpm: null,
            rpd: null,
            cc: null,
          });
          if (!res.ok) {
            toast.error(res.error || "添加服务商失败");
            return;
          }
          // 添加成功提示
          toast.success("添加服务商成功", {
            description: `服务商 "${name.trim()}" 已添加`,
          });
          // 重置表单（仅新增）
          setName("");
          setUrl("");
          setKey("");
          setProviderType("claude");
          setModelRedirects({});
          setAllowedModels([]);
          setJoinClaudePool(false);
          setPriority(0);
          setWeight(1);
          setCostMultiplier(1.0);
          setGroupTag("");
          setLimit5hUsd(null);
          setLimitWeeklyUsd(null);
          setLimitMonthlyUsd(null);
          setLimitConcurrentSessions(null);
        }
        onSuccess?.();
      } catch (error) {
        console.error(isEdit ? "更新服务商失败:" : "添加服务商失败:", error);
        toast.error(isEdit ? "更新服务商失败" : "添加服务商失败");
      }
    });
  };

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? "编辑服务商" : "新增服务商"}</DialogTitle>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={isEdit ? "edit-name" : "name"}>服务商名称 *</Label>
          <Input
            id={isEdit ? "edit-name" : "name"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如: 智谱"
            disabled={isPending}
            required
          />
        </div>

        {/* 移除描述字段 */}

        <div className="space-y-2">
          <Label htmlFor={isEdit ? "edit-url" : "url"}>API 地址 *</Label>
          <Input
            id={isEdit ? "edit-url" : "url"}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="例如: https://open.bigmodel.cn/api/anthropic"
            disabled={isPending}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={isEdit ? "edit-key" : "key"}>
            API 密钥{isEdit ? "（留空不更改）" : " *"}
          </Label>
          <Input
            id={isEdit ? "edit-key" : "key"}
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={isEdit ? "留空则不更改密钥" : "输入 API 密钥"}
            disabled={isPending}
            required={!isEdit}
          />
          {isEdit && provider ? (
            <div className="text-xs text-muted-foreground">当前密钥: {provider.maskedKey}</div>
          ) : null}
        </div>

        {/* Codex 支持：供应商类型和模型重定向 */}
        <div className="space-y-4 pt-2 border-t">
          <div className="space-y-2">
            <Label htmlFor={isEdit ? "edit-provider-type" : "provider-type"}>
              供应商类型
              <span className="text-xs text-muted-foreground ml-1">(决定调度策略)</span>
            </Label>
            <Select
              value={providerType}
              onValueChange={(value) => setProviderType(value as ProviderType)}
              disabled={isPending}
            >
              <SelectTrigger id={isEdit ? "edit-provider-type" : "provider-type"}>
                <SelectValue placeholder="选择供应商类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude">Claude (Anthropic Messages API)</SelectItem>
                <SelectItem value="codex" disabled>
                  Codex (Response API) - 功能开发中
                </SelectItem>
                <SelectItem value="gemini-cli" disabled>
                  Gemini CLI - 功能开发中
                </SelectItem>
                <SelectItem value="openai-compatible" disabled>
                  OpenAI Compatible - 功能开发中
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              选择供应商的 API 格式类型。
              <span className="text-amber-600 ml-1">
                注：除 Claude 外的其他类型功能正在开发中，暂不可用
              </span>
            </p>
          </div>

          <div className="space-y-2">
            <Label>
              模型重定向配置
              <span className="text-xs text-muted-foreground ml-1">(可选)</span>
            </Label>
            <ModelRedirectEditor
              value={modelRedirects}
              onChange={setModelRedirects}
              disabled={isPending}
            />
          </div>

          {/* joinClaudePool 开关 - 仅非 Claude 供应商显示 */}
          {providerType !== "claude" &&
            (() => {
              // 检查是否有重定向到 Claude 模型的映射
              const hasClaudeRedirects = Object.values(modelRedirects).some((target) =>
                target.startsWith("claude-")
              );

              if (!hasClaudeRedirects) return null;

              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor={isEdit ? "edit-join-claude-pool" : "join-claude-pool"}>
                        加入 Claude 调度池
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        启用后，此供应商将与 Claude 类型供应商一起参与负载均衡调度
                      </p>
                    </div>
                    <Switch
                      id={isEdit ? "edit-join-claude-pool" : "join-claude-pool"}
                      checked={joinClaudePool}
                      onCheckedChange={setJoinClaudePool}
                      disabled={isPending}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    仅当模型重定向配置中存在映射到 claude-* 模型时可用。启用后，当用户请求 claude-*
                    模型时，此供应商也会参与调度选择。
                  </p>
                </div>
              );
            })()}
        </div>

        {/* 模型白名单配置 */}
        <div className="space-y-4 pt-2 border-t">
          <div className="space-y-1">
            <div className="text-sm font-medium">模型白名单</div>
            <p className="text-xs text-muted-foreground">
              限制此供应商可以处理的模型。默认情况下，供应商可以处理该类型下的所有模型。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="allowed-models">
              允许的模型
              <span className="text-xs text-muted-foreground ml-1">(可选)</span>
            </Label>

            <ModelMultiSelect
              providerType={providerType as "claude" | "codex" | "gemini-cli" | "openai-compatible"}
              selectedModels={allowedModels}
              onChange={setAllowedModels}
              disabled={isPending}
            />

            {allowedModels.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2 p-2 bg-muted/50 rounded-md">
                {allowedModels.slice(0, 5).map((model) => (
                  <Badge key={model} variant="outline" className="font-mono text-xs">
                    {model}
                  </Badge>
                ))}
                {allowedModels.length > 5 && (
                  <Badge variant="secondary" className="text-xs">
                    +{allowedModels.length - 5} 更多
                  </Badge>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {allowedModels.length === 0 ? (
                <span className="text-green-600">✓ 允许所有模型（推荐）</span>
              ) : (
                <span>
                  仅允许选中的 {allowedModels.length} 个模型。其他模型的请求不会调度到此供应商。
                </span>
              )}
            </p>
          </div>
        </div>

        {/* 路由配置 */}
        <div className="space-y-4 pt-2 border-t">
          <div className="text-sm font-medium">路由配置</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor={isEdit ? "edit-priority" : "priority"}>
                优先级
                <span className="text-xs text-muted-foreground ml-1">(0最高)</span>
              </Label>
              <Input
                id={isEdit ? "edit-priority" : "priority"}
                type="number"
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                placeholder="0"
                disabled={isPending}
                min="0"
                step="1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={isEdit ? "edit-weight" : "weight"}>
                权重
                <span className="text-xs text-muted-foreground ml-1">(负载均衡)</span>
              </Label>
              <Input
                id={isEdit ? "edit-weight" : "weight"}
                type="number"
                value={weight}
                onChange={(e) => setWeight(parseInt(e.target.value) || 1)}
                placeholder="1"
                disabled={isPending}
                min="1"
                step="1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={isEdit ? "edit-cost" : "cost"}>
                成本倍率
                <span className="text-xs text-muted-foreground ml-1">(相对官方定价)</span>
              </Label>
              <Input
                id={isEdit ? "edit-cost" : "cost"}
                type="number"
                value={costMultiplier}
                onChange={(e) => setCostMultiplier(parseFloat(e.target.value) || 1.0)}
                placeholder="1.0 表示官方价格"
                disabled={isPending}
                min="0"
                step="0.01"
              />
              <p className="text-xs text-muted-foreground">
                例如填 0.6 表示按官方价格的 60% 计费，填 1.0 表示官方价格
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={isEdit ? "edit-group" : "group"}>
              供应商分组
              <span className="text-xs text-muted-foreground ml-1">(用于用户绑定)</span>
            </Label>
            <Input
              id={isEdit ? "edit-group" : "group"}
              value={groupTag}
              onChange={(e) => setGroupTag(e.target.value)}
              placeholder="例如: premium, economy"
              disabled={isPending}
            />
          </div>
        </div>

        {/* 限流配置 */}
        <div className="space-y-4 pt-2 border-t">
          <div className="text-sm font-medium">限流配置</div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={isEdit ? "edit-limit-5h" : "limit-5h"}>5小时消费上限 (USD)</Label>
              <Input
                id={isEdit ? "edit-limit-5h" : "limit-5h"}
                type="number"
                value={limit5hUsd?.toString() ?? ""}
                onChange={(e) => setLimit5hUsd(validateNumericField(e.target.value))}
                placeholder="留空表示无限制"
                disabled={isPending}
                min="0"
                step="0.01"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={isEdit ? "edit-limit-weekly" : "limit-weekly"}>
                周消费上限 (USD)
              </Label>
              <Input
                id={isEdit ? "edit-limit-weekly" : "limit-weekly"}
                type="number"
                value={limitWeeklyUsd?.toString() ?? ""}
                onChange={(e) => setLimitWeeklyUsd(validateNumericField(e.target.value))}
                placeholder="留空表示无限制"
                disabled={isPending}
                min="0"
                step="0.01"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={isEdit ? "edit-limit-monthly" : "limit-monthly"}>
                月消费上限 (USD)
              </Label>
              <Input
                id={isEdit ? "edit-limit-monthly" : "limit-monthly"}
                type="number"
                value={limitMonthlyUsd?.toString() ?? ""}
                onChange={(e) => setLimitMonthlyUsd(validateNumericField(e.target.value))}
                placeholder="留空表示无限制"
                disabled={isPending}
                min="0"
                step="0.01"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={isEdit ? "edit-limit-concurrent" : "limit-concurrent"}>
                并发 Session 上限
              </Label>
              <Input
                id={isEdit ? "edit-limit-concurrent" : "limit-concurrent"}
                type="number"
                value={limitConcurrentSessions?.toString() ?? ""}
                onChange={(e) => setLimitConcurrentSessions(validateNumericField(e.target.value))}
                placeholder="0 表示无限制"
                disabled={isPending}
                min="0"
                step="1"
              />
            </div>
          </div>
        </div>

        {isEdit ? (
          <div className="flex items-center justify-between pt-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={isPending}>
                  删除
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertHeader>
                  <AlertTitle>删除服务商</AlertTitle>
                  <AlertDialogDescription>
                    确定要删除服务商&ldquo;{provider?.name}&rdquo;吗？此操作不可恢复。
                  </AlertDialogDescription>
                </AlertHeader>
                <div className="flex gap-2 justify-end">
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      if (!provider) return;
                      startTransition(async () => {
                        try {
                          const res = await removeProvider(provider.id);
                          if (!res.ok) {
                            toast.error(res.error || "删除服务商失败");
                            return;
                          }
                          onSuccess?.();
                        } catch (e) {
                          console.error("删除服务商失败", e);
                          toast.error("删除服务商失败");
                        }
                      });
                    }}
                  >
                    确认删除
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialog>

            <Button type="submit" disabled={isPending}>
              {isPending ? "更新中..." : "确认更新"}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-4">
            <Button type="submit" disabled={isPending}>
              {isPending ? "添加中..." : "确认添加"}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
