"use client";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle,
  Copy,
  Edit,
  Globe,
  Key,
  RotateCcw,
  Trash,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  editProvider,
  getUnmaskedProviderKey,
  removeProvider,
  resetProviderCircuit,
  resetProviderTotalUsage,
} from "@/actions/providers";
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
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { PROVIDER_GROUP, PROVIDER_LIMITS } from "@/lib/constants/provider.constants";
import { getProviderTypeConfig, getProviderTypeTranslationKey } from "@/lib/provider-type-utils";
import { copyToClipboard, isClipboardSupported } from "@/lib/utils/clipboard";
import { getContrastTextColor, getGroupColor } from "@/lib/utils/color";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import type { ProviderDisplay, ProviderStatistics } from "@/types/provider";
import type { User } from "@/types/user";
import { ProviderForm } from "./forms/provider-form";
import { InlineEditPopover } from "./inline-edit-popover";

interface ProviderRichListItemProps {
  provider: ProviderDisplay;
  currentUser?: User;
  healthStatus?: {
    circuitState: "closed" | "open" | "half-open";
    failureCount: number;
    lastFailureTime: number | null;
    circuitOpenUntil: number | null;
    recoveryMinutes: number | null;
  };
  statistics?: ProviderStatistics;
  statisticsLoading?: boolean;
  currencyCode?: CurrencyCode;
  enableMultiProviderTypes: boolean;
  onEdit?: () => void;
  onClone?: () => void;
  onDelete?: () => void;
}

export function ProviderRichListItem({
  provider,
  currentUser,
  healthStatus,
  statistics,
  statisticsLoading = false,
  currencyCode = "USD",
  enableMultiProviderTypes,
  onEdit: onEditProp,
  onClone: onCloneProp,
  onDelete: onDeleteProp,
}: ProviderRichListItemProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [openEdit, setOpenEdit] = useState(false);
  const [openClone, setOpenClone] = useState(false);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [unmaskedKey, setUnmaskedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clipboardAvailable, setClipboardAvailable] = useState(false);
  const [resetPending, startResetTransition] = useTransition();
  const [resetUsagePending, startResetUsageTransition] = useTransition();
  const [deletePending, startDeleteTransition] = useTransition();
  const [togglePending, startToggleTransition] = useTransition();

  const canEdit = currentUser?.role === "admin";
  const tTypes = useTranslations("settings.providers.types");
  const tList = useTranslations("settings.providers.list");
  const tTimeout = useTranslations("settings.providers.form.sections.timeout");
  const tInline = useTranslations("settings.providers.inlineEdit");

  const validatePriority = (raw: string) => {
    if (raw.length === 0) return tInline("priorityInvalid");
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 2147483647)
      return tInline("priorityInvalid");
    return null;
  };

  const validateWeight = (raw: string) => {
    if (raw.length === 0) return tInline("weightInvalid");
    const value = Number(raw);
    if (
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < PROVIDER_LIMITS.WEIGHT.MIN ||
      value > PROVIDER_LIMITS.WEIGHT.MAX
    )
      return tInline("weightInvalid");
    return null;
  };

  const validateCostMultiplier = (raw: string) => {
    if (raw.length === 0) return tInline("costMultiplierInvalid");
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return tInline("costMultiplierInvalid");
    return null;
  };

  // 获取供应商类型配置
  const typeConfig = getProviderTypeConfig(provider.providerType);
  const TypeIcon = typeConfig.icon;
  const typeKey = getProviderTypeTranslationKey(provider.providerType);
  const typeLabel = tTypes(`${typeKey}.label`);
  const typeDescription = tTypes(`${typeKey}.description`);

  useEffect(() => {
    setClipboardAvailable(isClipboardSupported());
  }, []);

  // 处理编辑
  const handleEdit = () => {
    if (onEditProp) {
      onEditProp();
    } else {
      setOpenEdit(true);
    }
  };

  // 处理克隆
  const handleClone = () => {
    if (onCloneProp) {
      onCloneProp();
    } else {
      setOpenClone(true);
    }
  };

  // 处理删除
  const handleDelete = () => {
    if (onDeleteProp) {
      onDeleteProp();
    } else {
      startDeleteTransition(async () => {
        try {
          const res = await removeProvider(provider.id);
          if (res.ok) {
            toast.success(tList("deleteSuccess"), {
              description: tList("deleteSuccessDesc", { name: provider.name }),
            });
            queryClient.invalidateQueries({ queryKey: ["providers"] });
            queryClient.invalidateQueries({ queryKey: ["providers-health"] });
            router.refresh();
          } else {
            toast.error(tList("deleteFailed"), {
              description: res.error || tList("unknownError"),
            });
          }
        } catch (error) {
          console.error("Failed to delete provider:", error);
          toast.error(tList("deleteFailed"), {
            description: tList("deleteError"),
          });
        }
      });
    }
  };

  // 处理查看密钥
  const handleShowKey = async () => {
    setShowKeyDialog(true);
    try {
      const result = await getUnmaskedProviderKey(provider.id);
      if (result.ok) {
        setUnmaskedKey(result.data.key);
      } else {
        toast.error(tList("getKeyFailed"), {
          description: result.error || tList("unknownError"),
        });
        setShowKeyDialog(false);
      }
    } catch (error) {
      console.error("Failed to get provider key:", error);
      toast.error(tList("getKeyFailed"), {
        description: tList("unknownError"),
      });
      setShowKeyDialog(false);
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

  // 处理关闭 Dialog
  const handleCloseDialog = () => {
    setShowKeyDialog(false);
    setUnmaskedKey(null);
    setCopied(false);
  };

  // 处理手动解除熔断
  const handleResetCircuit = () => {
    startResetTransition(async () => {
      try {
        const res = await resetProviderCircuit(provider.id);
        if (res.ok) {
          toast.success(tList("resetCircuitSuccess"), {
            description: tList("resetCircuitSuccessDesc", { name: provider.name }),
          });
          queryClient.invalidateQueries({ queryKey: ["providers"] });
          queryClient.invalidateQueries({ queryKey: ["providers-health"] });
          router.refresh();
        } else {
          toast.error(tList("resetCircuitFailed"), {
            description: res.error || tList("unknownError"),
          });
        }
      } catch (error) {
        console.error("Failed to reset circuit breaker:", error);
        toast.error(tList("resetCircuitFailed"), {
          description: tList("deleteError"),
        });
      }
    });
  };

  // 处理手动重置总用量（总限额用）
  const handleResetTotalUsage = () => {
    startResetUsageTransition(async () => {
      try {
        const res = await resetProviderTotalUsage(provider.id);
        if (res.ok) {
          toast.success(tList("resetUsageSuccess"), {
            description: tList("resetUsageSuccessDesc", { name: provider.name }),
          });
          queryClient.invalidateQueries({ queryKey: ["providers"] });
          queryClient.invalidateQueries({ queryKey: ["providers-health"] });
          router.refresh();
        } else {
          toast.error(tList("resetUsageFailed"), {
            description: res.error || tList("unknownError"),
          });
        }
      } catch (error) {
        console.error("Failed to reset total usage:", error);
        toast.error(tList("resetUsageFailed"), {
          description: tList("deleteError"),
        });
      }
    });
  };

  // 处理启用/禁用切换
  const handleToggle = () => {
    startToggleTransition(async () => {
      try {
        const res = await editProvider(provider.id, {
          is_enabled: !provider.isEnabled,
        });
        if (res.ok) {
          const status = !provider.isEnabled ? tList("statusEnabled") : tList("statusDisabled");
          toast.success(tList("toggleSuccess", { status }), {
            description: tList("toggleSuccessDesc", { name: provider.name }),
          });
          queryClient.invalidateQueries({ queryKey: ["providers"] });
          queryClient.invalidateQueries({ queryKey: ["providers-health"] });
          router.refresh();
        } else {
          toast.error(tList("toggleFailed"), {
            description: res.error || tList("unknownError"),
          });
        }
      } catch (error) {
        console.error("Failed to toggle provider status:", error);
        toast.error(tList("toggleFailed"), {
          description: tList("deleteError"),
        });
      }
    });
  };

  const createSaveHandler = (fieldName: "priority" | "weight" | "cost_multiplier") => {
    return async (value: number) => {
      try {
        const res = await editProvider(provider.id, { [fieldName]: value } as Parameters<
          typeof editProvider
        >[1]);
        if (res.ok) {
          toast.success(tInline("saveSuccess"));
          queryClient.invalidateQueries({ queryKey: ["providers"] });
          router.refresh();
          return true;
        }
        toast.error(tInline("saveFailed"), { description: res.error || tList("unknownError") });
        return false;
      } catch (error) {
        console.error(`Failed to update ${fieldName}:`, error);
        toast.error(tInline("saveFailed"), { description: tList("unknownError") });
        return false;
      }
    };
  };

  const handleSavePriority = createSaveHandler("priority");
  const handleSaveWeight = createSaveHandler("weight");
  const handleSaveCostMultiplier = createSaveHandler("cost_multiplier");

  return (
    <>
      <div className="flex items-center gap-4 py-3 px-4 border-b hover:bg-muted/50 transition-colors">
        {/* 左侧：状态和类型图标 */}
        <div className="flex items-center gap-2">
          {/* 启用状态指示器 */}
          {provider.isEnabled ? (
            <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 text-gray-400 flex-shrink-0" />
          )}

          {/* 类型图标 */}
          <div
            className={`flex items-center justify-center w-6 h-6 rounded ${typeConfig.bgColor} flex-shrink-0`}
            title={`${typeLabel} · ${typeDescription}`}
            aria-label={typeLabel}
          >
            <TypeIcon className="h-3.5 w-3.5" aria-hidden />
          </div>
        </div>

        {/* 中间：名称、URL、官网、tag、熔断状态 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Favicon */}
            {provider.faviconUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={provider.faviconUrl}
                alt=""
                className="h-4 w-4 flex-shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}

            {/* 名称 */}
            <span className="font-semibold truncate">{provider.name}</span>

            {/* Group Tags (supports comma-separated values) */}
            {(provider.groupTag
              ? provider.groupTag
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
              : []
            ).length > 0 ? (
              provider.groupTag
                ?.split(",")
                .map((t) => t.trim())
                .filter(Boolean)
                .map((tag, index) => {
                  const bgColor = getGroupColor(tag);
                  return (
                    <Badge
                      key={`${tag}-${index}`}
                      className="flex-shrink-0 text-xs"
                      style={{
                        backgroundColor: bgColor,
                        color: getContrastTextColor(bgColor),
                      }}
                    >
                      {tag}
                    </Badge>
                  );
                })
            ) : (
              <Badge variant="outline" className="flex-shrink-0">
                {PROVIDER_GROUP.DEFAULT}
              </Badge>
            )}

            {/* 熔断器警告 */}
            {healthStatus && healthStatus.circuitState === "open" && (
              <Badge variant="destructive" className="flex items-center gap-1 flex-shrink-0">
                <AlertTriangle className="h-3 w-3" />
                {tList("circuitBroken")}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
            {/* URL */}
            <span className="truncate max-w-[300px]">{provider.url}</span>

            {/* 官网链接 */}
            {provider.websiteUrl && (
              <a
                href={provider.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:underline text-blue-600 hover:text-blue-700 flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <Globe className="h-3 w-3" />
                {tList("officialWebsite")}
              </a>
            )}

            {/* API Key 展示（仅管理员） */}
            {canEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleShowKey();
                }}
                className="inline-flex items-center gap-1 text-xs font-mono hover:underline flex-shrink-0"
              >
                <Key className="h-3 w-3" />
                {provider.maskedKey}
              </button>
            )}

            {/* 超时配置可视化（紧凑格式） */}
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {tTimeout("summary", {
                streaming:
                  provider.firstByteTimeoutStreamingMs === 0
                    ? "∞"
                    : ((provider.firstByteTimeoutStreamingMs || 30000) / 1000).toString(),
                idle:
                  provider.streamingIdleTimeoutMs === 0
                    ? "∞"
                    : ((provider.streamingIdleTimeoutMs || 10000) / 1000).toString(),
                nonStreaming:
                  provider.requestTimeoutNonStreamingMs === 0
                    ? "∞"
                    : ((provider.requestTimeoutNonStreamingMs || 600000) / 1000).toString(),
              })}
            </span>
          </div>
        </div>

        {/* 右侧：指标（仅桌面端） */}
        <div className="hidden md:grid grid-cols-3 gap-4 text-center flex-shrink-0">
          <div>
            <div className="text-xs text-muted-foreground">{tList("priority")}</div>
            <div className="font-medium">
              {canEdit ? (
                <InlineEditPopover
                  value={provider.priority}
                  label={tInline("priorityLabel")}
                  type="integer"
                  validator={validatePriority}
                  onSave={handleSavePriority}
                />
              ) : (
                <span>{provider.priority}</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{tList("weight")}</div>
            <div className="font-medium">
              {canEdit ? (
                <InlineEditPopover
                  value={provider.weight}
                  label={tInline("weightLabel")}
                  type="integer"
                  validator={validateWeight}
                  onSave={handleSaveWeight}
                />
              ) : (
                <span>{provider.weight}</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{tList("costMultiplier")}</div>
            <div className="font-medium">
              {canEdit ? (
                <InlineEditPopover
                  value={provider.costMultiplier}
                  label={tInline("costMultiplierLabel")}
                  validator={validateCostMultiplier}
                  onSave={handleSaveCostMultiplier}
                  suffix="x"
                  type="number"
                />
              ) : (
                <span>{provider.costMultiplier}x</span>
              )}
            </div>
          </div>
        </div>

        {/* 今日用量（仅大屏） */}
        <div className="hidden lg:block text-center flex-shrink-0 min-w-[100px]">
          <div className="text-xs text-muted-foreground">{tList("todayUsageLabel")}</div>
          {statisticsLoading ? (
            <>
              <Skeleton className="h-5 w-16 mx-auto my-0.5" />
              <Skeleton className="h-4 w-12 mx-auto mt-0.5" />
            </>
          ) : (
            <>
              <div className="font-medium">
                {tList("todayUsageCount", {
                  count: statistics?.todayCalls ?? provider.todayCallCount ?? 0,
                })}
              </div>
              <div className="text-xs font-mono text-muted-foreground mt-0.5">
                {formatCurrency(
                  parseFloat(statistics?.todayCost ?? provider.todayTotalCostUsd ?? "0"),
                  currencyCode
                )}
              </div>
            </>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* 启用/禁用切换 */}
          {canEdit && (
            <Switch
              checked={provider.isEnabled}
              onCheckedChange={handleToggle}
              disabled={togglePending}
              className="data-[state=checked]:bg-green-500"
            />
          )}

          {/* 编辑按钮 */}
          {canEdit && (
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                handleEdit();
              }}
              disabled={!canEdit}
            >
              <Edit className="h-4 w-4" />
            </Button>
          )}

          {/* 克隆按钮 */}
          {canEdit && (
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                handleClone();
              }}
              disabled={!canEdit}
            >
              <Copy className="h-4 w-4" />
            </Button>
          )}

          {/* 熔断重置按钮（仅熔断时显示） */}
          {canEdit && healthStatus && healthStatus.circuitState === "open" && (
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                handleResetCircuit();
              }}
              disabled={resetPending}
            >
              <RotateCcw className="h-4 w-4 text-orange-600" />
            </Button>
          )}

          {/* 总用量重置按钮（仅配置了总限额时显示） */}
          {canEdit && provider.limitTotalUsd !== null && provider.limitTotalUsd > 0 && (
            <Button
              size="icon"
              variant="ghost"
              title={tList("resetUsageTitle")}
              onClick={(e) => {
                e.stopPropagation();
                handleResetTotalUsage();
              }}
              disabled={resetUsagePending}
            >
              <RotateCcw className="h-4 w-4 text-blue-600" />
            </Button>
          )}

          {/* 删除按钮 */}
          {canEdit && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={(e) => e.stopPropagation()}
                  disabled={!canEdit}
                >
                  <Trash className="h-4 w-4 text-red-600" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{tList("confirmDeleteTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {tList("confirmDeleteMessage", { name: provider.name })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex justify-end gap-2">
                  <AlertDialogCancel>{tList("cancelButton")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete();
                    }}
                    className="bg-red-600 hover:bg-red-700"
                    disabled={deletePending}
                  >
                    {tList("deleteButton")}
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* 编辑 Dialog */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
          <FormErrorBoundary>
            <ProviderForm
              mode="edit"
              provider={provider}
              onSuccess={() => {
                setOpenEdit(false);
                queryClient.invalidateQueries({ queryKey: ["providers"] });
                queryClient.invalidateQueries({ queryKey: ["providers-health"] });
                router.refresh();
              }}
              enableMultiProviderTypes={enableMultiProviderTypes}
            />
          </FormErrorBoundary>
        </DialogContent>
      </Dialog>

      {/* 克隆 Dialog */}
      <Dialog open={openClone} onOpenChange={setOpenClone}>
        <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
          <FormErrorBoundary>
            <ProviderForm
              mode="create"
              cloneProvider={provider}
              onSuccess={() => {
                setOpenClone(false);
                queryClient.invalidateQueries({ queryKey: ["providers"] });
                queryClient.invalidateQueries({ queryKey: ["providers-health"] });
                router.refresh();
              }}
              enableMultiProviderTypes={enableMultiProviderTypes}
            />
          </FormErrorBoundary>
        </DialogContent>
      </Dialog>

      {/* API Key 展示 Dialog */}
      <Dialog open={showKeyDialog} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tList("viewFullKey")}</DialogTitle>
            <DialogDescription>{tList("viewFullKeyDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono bg-muted px-3 py-2 rounded text-sm break-all">
                {unmaskedKey || tList("keyLoading")}
              </code>
              {clipboardAvailable && (
                <Button onClick={handleCopy} disabled={!unmaskedKey} size="icon" variant="outline">
                  {copied ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
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
    </>
  );
}
