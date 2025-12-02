"use client";
import { CheckCircle, Copy, Edit, Globe, Key, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { getUnmaskedProviderKey, resetProviderCircuit } from "@/actions/providers";
import { FormErrorBoundary } from "@/components/form-error-boundary";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PROVIDER_LIMITS } from "@/lib/constants/provider.constants";
import { getProviderTypeConfig, getProviderTypeTranslationKey } from "@/lib/provider-type-utils";
import { copyToClipboard, isClipboardSupported } from "@/lib/utils/clipboard";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import type { ProviderDisplay } from "@/types/provider";
import type { User } from "@/types/user";
import { ProviderForm } from "./forms/provider-form";
import { useProviderEdit } from "./hooks/use-provider-edit";

interface ProviderListItemProps {
  item: ProviderDisplay;
  currentUser?: User;
  healthStatus?: {
    circuitState: "closed" | "open" | "half-open";
    failureCount: number;
    lastFailureTime: number | null;
    circuitOpenUntil: number | null;
    recoveryMinutes: number | null;
  };
  currencyCode?: CurrencyCode;
  enableMultiProviderTypes: boolean;
}

export function ProviderListItem({
  item,
  currentUser,
  healthStatus,
  currencyCode = "USD",
  enableMultiProviderTypes,
}: ProviderListItemProps) {
  const router = useRouter();
  const [openEdit, setOpenEdit] = useState(false);
  const [openClone, setOpenClone] = useState(false);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [unmaskedKey, setUnmaskedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clipboardAvailable, setClipboardAvailable] = useState(false);
  const [resetPending, startResetTransition] = useTransition();
  const canEdit = currentUser?.role === "admin";
  const t = useTranslations("settings.providers.types");
  const tList = useTranslations("settings.providers.list");
  const tTimeout = useTranslations("settings.providers.form.sections.timeout");

  const {
    enabled,
    togglePending,
    weight,
    setWeight,
    showWeight,
    limit5hInfinite,
    setLimit5hInfinite,
    limit5hValue,
    setLimit5hValue,
    show5hLimit,
    limitWeeklyInfinite,
    setLimitWeeklyInfinite,
    limitWeeklyValue,
    setLimitWeeklyValue,
    showWeeklyLimit,
    limitMonthlyInfinite,
    setLimitMonthlyInfinite,
    limitMonthlyValue,
    setLimitMonthlyValue,
    showMonthlyLimit,
    concurrentInfinite,
    setConcurrentInfinite,
    concurrentValue,
    setConcurrentValue,
    showConcurrent,
    handleToggle,
    handleWeightPopover,
    handle5hLimitPopover,
    handleWeeklyLimitPopover,
    handleMonthlyLimitPopover,
    handleConcurrentPopover,
  } = useProviderEdit(item, canEdit);

  // 获取供应商类型配置
  const typeConfig = getProviderTypeConfig(item.providerType);
  const TypeIcon = typeConfig.icon;
  const typeKey = getProviderTypeTranslationKey(item.providerType);
  const typeLabel = t(`${typeKey}.label`);
  const typeDescription = t(`${typeKey}.description`);

  useEffect(() => {
    setClipboardAvailable(isClipboardSupported());
  }, []);

  // 处理手动解除熔断
  const handleResetCircuit = () => {
    startResetTransition(async () => {
      try {
        const res = await resetProviderCircuit(item.id);
        if (res.ok) {
          toast.success("熔断器已重置", {
            description: `供应商 "${item.name}" 的熔断状态已解除`,
          });
          // 刷新页面数据以同步熔断器状态
          router.refresh();
        } else {
          toast.error("重置熔断器失败", {
            description: res.error || "未知错误",
          });
        }
      } catch (error) {
        console.error("重置熔断器失败:", error);
        toast.error("重置熔断器失败", {
          description: "操作过程中出现异常",
        });
      }
    });
  };

  // 处理查看密钥
  const handleShowKey = async () => {
    setShowKeyDialog(true);
    const result = await getUnmaskedProviderKey(item.id);
    if (result.ok) {
      setUnmaskedKey(result.data.key);
    } else {
      toast.error("获取密钥失败", {
        description: result.error || "未知错误",
      });
    }
  };

  // 处理复制密钥
  const handleCopy = async () => {
    if (unmaskedKey) {
      const success = await copyToClipboard(unmaskedKey);

      if (success) {
        setCopied(true);
        toast.success(tList("keyCopied"));
        setTimeout(() => setCopied(false), 3000);
      } else {
        toast.error(tList("copyFailed"));
      }
    }
  };

  // 处理关闭对话框
  const handleCloseDialog = () => {
    setShowKeyDialog(false);
    setUnmaskedKey(null);
    setCopied(false);
  };

  return (
    <div className="group relative h-full rounded-xl border border-border/70 bg-card p-4 shadow-sm transition-all duration-150 hover:shadow-md hover:border-border focus-within:ring-1 focus-within:ring-primary/20">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-semibold ${enabled ? "bg-green-500/15 text-green-600" : "bg-muted text-muted-foreground"}`}
            >
              ●
            </span>
            {/* 供应商类型图标 */}
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-md ${typeConfig.bgColor}`}
              title={typeDescription}
            >
              <TypeIcon className={`h-3 w-3 ${typeConfig.iconColor}`} />
            </span>
            <h3 className="text-sm font-semibold text-foreground truncate tracking-tight">
              {item.name}
            </h3>
            {/* 供应商类型标签 */}
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-normal">
              {typeLabel}
            </Badge>

            {/* 熔断器状态徽章 */}
            {healthStatus?.circuitState === "open" && (
              <>
                <Badge variant="destructive" className="text-xs h-5 px-2">
                  🔴 熔断中
                  {healthStatus.recoveryMinutes && healthStatus.recoveryMinutes > 0 && (
                    <span className="ml-1 opacity-80">
                      ({healthStatus.recoveryMinutes}分钟后重试)
                    </span>
                  )}
                </Badge>

                {/* 手动解除熔断按钮 - 仅管理员可见 */}
                {canEdit && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 p-0 text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                        disabled={resetPending}
                        title="手动解除熔断"
                      >
                        <RotateCcw
                          className={`h-3.5 w-3.5 ${resetPending ? "animate-spin" : ""}`}
                        />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>手动解除熔断</AlertDialogTitle>
                        <AlertDialogDescription>
                          确定要手动解除供应商 &ldquo;{item.name}&rdquo; 的熔断状态吗？
                          <br />
                          <span className="text-destructive font-medium">
                            请确保上游服务已恢复正常，否则可能导致请求持续失败。
                          </span>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="flex gap-2 justify-end">
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={handleResetCircuit}>确认解除</AlertDialogAction>
                      </div>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </>
            )}
            {healthStatus?.circuitState === "half-open" && (
              <Badge
                variant="secondary"
                className="text-xs h-5 px-2 border-yellow-500/50 bg-yellow-500/10 text-yellow-700"
              >
                🟡 恢复中
              </Badge>
            )}

            {/* 编辑和克隆按钮 - 仅管理员可见 */}
            {canEdit && (
              <div className="flex items-center gap-1">
                {/* 编辑按钮 */}
                <Dialog open={openEdit} onOpenChange={setOpenEdit}>
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      aria-label="编辑服务商"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
                    <FormErrorBoundary>
                      <ProviderForm
                        mode="edit"
                        provider={item}
                        enableMultiProviderTypes={enableMultiProviderTypes}
                        onSuccess={() => {
                          setOpenEdit(false);
                          // 刷新页面数据以同步所有字段
                          router.refresh();
                        }}
                      />
                    </FormErrorBoundary>
                  </DialogContent>
                </Dialog>
                {/* 克隆按钮 */}
                <Dialog open={openClone} onOpenChange={setOpenClone}>
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      aria-label="克隆服务商"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
                    <FormErrorBoundary>
                      <ProviderForm
                        mode="create"
                        cloneProvider={item}
                        enableMultiProviderTypes={enableMultiProviderTypes}
                        onSuccess={() => {
                          setOpenClone(false);
                          // 刷新页面数据以显示新添加的服务商
                          router.refresh();
                        }}
                      />
                    </FormErrorBoundary>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>启用</span>
            <Switch
              aria-label="启用服务商"
              checked={enabled}
              disabled={!canEdit || togglePending}
              onCheckedChange={handleToggle}
            />
          </div>
        </div>
      </div>

      {/* 统计信息区域 */}
      <div className="mt-2 pt-2 border-t border-border/30 space-y-1 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground/80">今日用量:</span>
          <span className="tabular-nums">
            {formatCurrency(parseFloat(item.todayTotalCostUsd || "0"), currencyCode)} (
            {item.todayCallCount ?? 0} 次调用)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground/80">最近调用:</span>
          <span className="tabular-nums">
            {item.lastCallTime
              ? new Date(item.lastCallTime).toLocaleString("zh-CN", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "-"}
            {item.lastCallModel && item.lastCallTime ? ` - ${item.lastCallModel}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground/80">模型白名单:</span>
          {item.allowedModels && item.allowedModels.length > 0 ? (
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="font-mono text-xs h-4 px-1.5">
                {item.allowedModels.length} 个模型
              </Badge>
              <span className="text-muted-foreground">已启用</span>
            </div>
          ) : (
            <span className="text-green-600">✓ 允许所有模型</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground/80">超时配置:</span>
          <span className="tabular-nums">
            {tTimeout("summary", {
              streaming:
                item.firstByteTimeoutStreamingMs === 0
                  ? "∞"
                  : ((item.firstByteTimeoutStreamingMs || 30000) / 1000).toString(),
              idle:
                item.streamingIdleTimeoutMs === 0
                  ? "∞"
                  : ((item.streamingIdleTimeoutMs || 10000) / 1000).toString(),
              nonStreaming:
                item.requestTimeoutNonStreamingMs === 0
                  ? "∞"
                  : ((item.requestTimeoutNonStreamingMs || 600000) / 1000).toString(),
            })}
          </span>
        </div>
      </div>

      {/* 内容区改为上下结构 */}
      <div className="space-y-3 mb-3">
        {/* 上：URL 与密钥 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <Globe className="h-3.5 w-3.5 text-blue-500 shrink-0" />
            <span className="font-mono text-muted-foreground truncate">{item.url}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Key className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            {canEdit ? (
              <button
                onClick={handleShowKey}
                className="font-mono text-muted-foreground hover:text-foreground hover:underline cursor-pointer transition-colors"
                type="button"
              >
                {item.maskedKey}
              </button>
            ) : (
              <span className="font-mono text-muted-foreground">{item.maskedKey}</span>
            )}
          </div>
        </div>

        {/* 路由配置 */}
        <div className="grid grid-cols-4 gap-2 text-[11px] pb-2 border-b border-border/40">
          {/* 优先级 */}
          <div className="min-w-0 text-center">
            <div className="text-muted-foreground">优先级</div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-full text-center font-medium tabular-nums truncate text-foreground cursor-help">
                  <span>{item.priority}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="text-xs">
                  数值越小优先级越高（0 最高）。系统只从最高优先级的供应商中选择。
                </p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* 权重 */}
          <div className="min-w-0 text-center">
            <div className="text-muted-foreground">权重</div>
            {canEdit ? (
              <Popover open={showWeight} onOpenChange={handleWeightPopover}>
                <PopoverTrigger asChild>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="编辑权重"
                        className="w-full text-center font-medium tabular-nums truncate text-foreground cursor-pointer hover:text-primary/80 transition-colors"
                      >
                        <span>{weight}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p className="text-xs">
                        加权随机概率。同优先级内，权重越高被选中概率越大。点击可编辑。
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </PopoverTrigger>
                <PopoverContent align="center" side="bottom" sideOffset={6} className="w-64 p-3">
                  <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>调整权重</span>
                    <span className="font-medium text-foreground">{weight}</span>
                  </div>
                  <Slider
                    min={PROVIDER_LIMITS.WEIGHT.MIN}
                    max={PROVIDER_LIMITS.WEIGHT.MAX}
                    step={1}
                    value={[weight]}
                    onValueChange={(v) => setWeight(v?.[0] ?? PROVIDER_LIMITS.WEIGHT.MIN)}
                  />
                </PopoverContent>
              </Popover>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="w-full text-center font-medium tabular-nums truncate text-foreground cursor-help">
                    <span>{weight}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="text-xs">加权随机概率。同优先级内，权重越高被选中概率越大。</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* 成本倍率 */}
          <div className="min-w-0 text-center">
            <div className="text-muted-foreground">倍率</div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-full text-center font-medium tabular-nums truncate text-foreground cursor-help">
                  <span>{item.costMultiplier.toFixed(2)}x</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="text-xs">成本计算倍数。1.0x=官方价格，0.8x=便宜 20%，1.2x=贵 20%</p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* 分组 */}
          <div className="min-w-0 text-center">
            <div className="text-muted-foreground">分组</div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-full text-center font-medium truncate text-foreground cursor-help">
                  <span>{item.groupTag || "-"}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="text-xs">
                  只有 providerGroup 包含此标签的用户才能使用此供应商。未设置表示所有用户可用。
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* 限流配置 */}
        <div className="grid grid-cols-4 gap-2 text-[11px]">
          {/* 5小时消费上限 */}
          <div className="min-w-0 text-center">
            <div className="text-muted-foreground">5h USD</div>
            {canEdit ? (
              <Popover open={show5hLimit} onOpenChange={handle5hLimitPopover}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full text-center font-medium tabular-nums truncate text-foreground hover:text-primary/80 transition-colors cursor-pointer"
                  >
                    <span>{limit5hInfinite ? "∞" : `$${limit5hValue.toFixed(2)}`}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="center" side="bottom" sideOffset={6} className="w-72 p-3">
                  <div className="mb-2 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">5小时消费上限 (USD)</span>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>无限</span>
                      <Switch
                        checked={limit5hInfinite}
                        onCheckedChange={setLimit5hInfinite}
                        aria-label="无限"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Slider
                      min={PROVIDER_LIMITS.LIMIT_5H_USD.MIN}
                      max={PROVIDER_LIMITS.LIMIT_5H_USD.MAX}
                      step={PROVIDER_LIMITS.LIMIT_5H_USD.STEP}
                      value={[limit5hValue]}
                      onValueChange={(v) =>
                        !limit5hInfinite &&
                        setLimit5hValue(v?.[0] ?? PROVIDER_LIMITS.LIMIT_5H_USD.MIN)
                      }
                      disabled={limit5hInfinite}
                    />
                    <span className="w-16 text-right text-xs font-medium">
                      {limit5hInfinite ? "∞" : `$${limit5hValue.toFixed(2)}`}
                    </span>
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="w-full text-center font-medium tabular-nums truncate text-foreground">
                <span>{limit5hInfinite ? "∞" : `$${limit5hValue.toFixed(2)}`}</span>
              </div>
            )}
          </div>

          {/* 周消费上限 */}
          <div className="min-w-0 text-center">
            <div className="text-muted-foreground">Week USD</div>
            {canEdit ? (
              <Popover open={showWeeklyLimit} onOpenChange={handleWeeklyLimitPopover}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full text-center font-medium tabular-nums truncate text-foreground hover:text-primary/80 transition-colors cursor-pointer"
                  >
                    <span>{limitWeeklyInfinite ? "∞" : `$${limitWeeklyValue.toFixed(2)}`}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="center" side="bottom" sideOffset={6} className="w-72 p-3">
                  <div className="mb-2 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">周消费上限 (USD)</span>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>无限</span>
                      <Switch
                        checked={limitWeeklyInfinite}
                        onCheckedChange={setLimitWeeklyInfinite}
                        aria-label="无限"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Slider
                      min={PROVIDER_LIMITS.LIMIT_WEEKLY_USD.MIN}
                      max={PROVIDER_LIMITS.LIMIT_WEEKLY_USD.MAX}
                      step={PROVIDER_LIMITS.LIMIT_WEEKLY_USD.STEP}
                      value={[limitWeeklyValue]}
                      onValueChange={(v) =>
                        !limitWeeklyInfinite &&
                        setLimitWeeklyValue(v?.[0] ?? PROVIDER_LIMITS.LIMIT_WEEKLY_USD.MIN)
                      }
                      disabled={limitWeeklyInfinite}
                    />
                    <span className="w-16 text-right text-xs font-medium">
                      {limitWeeklyInfinite ? "∞" : `$${limitWeeklyValue.toFixed(2)}`}
                    </span>
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="w-full text-center font-medium tabular-nums truncate text-foreground">
                <span>{limitWeeklyInfinite ? "∞" : `$${limitWeeklyValue.toFixed(2)}`}</span>
              </div>
            )}
          </div>

          {/* 月消费上限 */}
          <div className="min-w-0 text-center">
            <div className="text-muted-foreground">Mon USD</div>
            {canEdit ? (
              <Popover open={showMonthlyLimit} onOpenChange={handleMonthlyLimitPopover}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full text-center font-medium tabular-nums truncate text-foreground hover:text-primary/80 transition-colors cursor-pointer"
                  >
                    <span>{limitMonthlyInfinite ? "∞" : `$${limitMonthlyValue.toFixed(2)}`}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="center" side="bottom" sideOffset={6} className="w-72 p-3">
                  <div className="mb-2 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">月消费上限 (USD)</span>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>无限</span>
                      <Switch
                        checked={limitMonthlyInfinite}
                        onCheckedChange={setLimitMonthlyInfinite}
                        aria-label="无限"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Slider
                      min={PROVIDER_LIMITS.LIMIT_MONTHLY_USD.MIN}
                      max={PROVIDER_LIMITS.LIMIT_MONTHLY_USD.MAX}
                      step={PROVIDER_LIMITS.LIMIT_MONTHLY_USD.STEP}
                      value={[limitMonthlyValue]}
                      onValueChange={(v) =>
                        !limitMonthlyInfinite &&
                        setLimitMonthlyValue(v?.[0] ?? PROVIDER_LIMITS.LIMIT_MONTHLY_USD.MIN)
                      }
                      disabled={limitMonthlyInfinite}
                    />
                    <span className="w-16 text-right text-xs font-medium">
                      {limitMonthlyInfinite ? "∞" : `$${limitMonthlyValue.toFixed(2)}`}
                    </span>
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="w-full text-center font-medium tabular-nums truncate text-foreground">
                <span>{limitMonthlyInfinite ? "∞" : `$${limitMonthlyValue.toFixed(2)}`}</span>
              </div>
            )}
          </div>

          {/* 并发Session上限 */}
          <div className="min-w-0 text-center">
            <div className="text-muted-foreground">并发</div>
            {canEdit ? (
              <Popover open={showConcurrent} onOpenChange={handleConcurrentPopover}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full text-center font-medium tabular-nums truncate text-foreground hover:text-primary/80 transition-colors cursor-pointer"
                  >
                    <span>{concurrentInfinite ? "∞" : concurrentValue.toLocaleString()}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="center" side="bottom" sideOffset={6} className="w-72 p-3">
                  <div className="mb-2 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">并发Session上限</span>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>无限</span>
                      <Switch
                        checked={concurrentInfinite}
                        onCheckedChange={setConcurrentInfinite}
                        aria-label="无限"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Slider
                      min={PROVIDER_LIMITS.CONCURRENT_SESSIONS.MIN}
                      max={PROVIDER_LIMITS.CONCURRENT_SESSIONS.MAX}
                      step={1}
                      value={[concurrentValue]}
                      onValueChange={(v) =>
                        !concurrentInfinite &&
                        setConcurrentValue(v?.[0] ?? PROVIDER_LIMITS.CONCURRENT_SESSIONS.MIN)
                      }
                      disabled={concurrentInfinite}
                    />
                    <span className="w-16 text-right text-xs font-medium">
                      {concurrentInfinite ? "∞" : concurrentValue.toLocaleString()}
                    </span>
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="w-full text-center font-medium tabular-nums truncate text-foreground">
                <span>{concurrentInfinite ? "∞" : concurrentValue.toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-border/60">
        <span>创建 {item.createdAt}</span>
        <span>更新 {item.updatedAt}</span>
      </div>

      {/* API Key 查看 Dialog */}
      <Dialog open={showKeyDialog} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-amber-500" />
              查看完整 API Key
            </DialogTitle>
            <DialogDescription>请妥善保管，不要泄露给他人</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono bg-muted px-3 py-2 rounded text-sm break-all border">
                {unmaskedKey || "加载中..."}
              </code>
              {clipboardAvailable && (
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleCopy}
                  disabled={!unmaskedKey}
                  type="button"
                >
                  {copied ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
            {!clipboardAvailable && (
              <p className="text-xs text-muted-foreground">{tList("clipboardUnavailable")}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
