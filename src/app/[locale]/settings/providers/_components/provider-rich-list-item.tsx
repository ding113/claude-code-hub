"use client";
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
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  editProvider,
  getUnmaskedProviderKey,
  removeProvider,
  resetProviderCircuit,
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
import { Switch } from "@/components/ui/switch";
import { getProviderTypeConfig, getProviderTypeTranslationKey } from "@/lib/provider-type-utils";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import type { ProviderDisplay } from "@/types/provider";
import type { User } from "@/types/user";
import { ProviderForm } from "./forms/provider-form";

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
  currencyCode = "USD",
  enableMultiProviderTypes,
  onEdit: onEditProp,
  onClone: onCloneProp,
  onDelete: onDeleteProp,
}: ProviderRichListItemProps) {
  const router = useRouter();
  const [openEdit, setOpenEdit] = useState(false);
  const [openClone, setOpenClone] = useState(false);
  const [openRecharge, setOpenRecharge] = useState(false);
  const [rechargeAmount, setRechargeAmount] = useState("");
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [unmaskedKey, setUnmaskedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resetPending, startResetTransition] = useTransition();
  const [deletePending, startDeleteTransition] = useTransition();
  const [togglePending, startToggleTransition] = useTransition();
  const [rechargePending, startRechargeTransition] = useTransition();

  const canEdit = currentUser?.role === "admin";
  const tTypes = useTranslations("settings.providers.types");
  const tList = useTranslations("settings.providers.list");
  const tTimeout = useTranslations("settings.providers.form.sections.timeout");

  // 获取供应商类型配置
  const typeConfig = getProviderTypeConfig(provider.providerType);
  const TypeIcon = typeConfig.icon;
  const typeKey = getProviderTypeTranslationKey(provider.providerType);
  const typeLabel = tTypes(`${typeKey}.label`);
  const typeDescription = tTypes(`${typeKey}.description`);

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
            router.refresh();
          } else {
            toast.error(tList("deleteFailed"), {
              description: res.error || tList("unknownError"),
            });
          }
        } catch (error) {
          console.error("删除供应商失败:", error);
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
    const result = await getUnmaskedProviderKey(provider.id);
    if (result.ok) {
      setUnmaskedKey(result.data.key);
    } else {
      toast.error(tList("getKeyFailed"), {
        description: result.error || tList("unknownError"),
      });
      setShowKeyDialog(false);
    }
  };

  // 处理复制密钥
  const handleCopy = async () => {
    if (unmaskedKey) {
      try {
        await navigator.clipboard.writeText(unmaskedKey);
        setCopied(true);
        toast.success(tList("keyCopied"));
        setTimeout(() => setCopied(false), 3000);
      } catch (error) {
        console.error("复制失败:", error);
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
          router.refresh();
        } else {
          toast.error(tList("resetCircuitFailed"), {
            description: res.error || tList("unknownError"),
          });
        }
      } catch (error) {
        console.error("重置熔断器失败:", error);
        toast.error(tList("resetCircuitFailed"), {
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
          router.refresh();
        } else {
          toast.error(tList("toggleFailed"), {
            description: res.error || tList("unknownError"),
          });
        }
      } catch (error) {
        console.error("状态切换失败:", error);
        toast.error(tList("toggleFailed"), {
          description: tList("deleteError"),
        });
      }
    });
  };

  // 处理余额充值
  const handleRecharge = () => {
    const amount = parseFloat(rechargeAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error(tList("rechargeDialog.invalidAmount"), {
        description: tList("rechargeDialog.invalidAmountDesc"),
      });
      return;
    }

    startRechargeTransition(async () => {
      try {
        const { rechargeProviderBalance } = await import("@/actions/providers");
        const res = await rechargeProviderBalance(provider.id, amount);
        if (res.ok) {
          toast.success(tList("rechargeDialog.successTitle"), {
            description: tList("rechargeDialog.successDesc", {
              amount: amount.toFixed(2),
              name: provider.name,
            }),
          });
          setOpenRecharge(false);
          setRechargeAmount("");
          router.refresh();
        } else {
          toast.error(tList("rechargeDialog.failedTitle"), {
            description: res.error || tList("unknownError"),
          });
        }
      } catch (error) {
        console.error("充值失败:", error);
        toast.error(tList("rechargeDialog.failedTitle"), {
          description: tList("rechargeDialog.errorDesc"),
        });
      }
    });
  };

  // 处理设置无限余额
  const handleSetUnlimited = () => {
    startRechargeTransition(async () => {
      try {
        const { setProviderBalanceUnlimited } = await import("@/actions/providers");
        const res = await setProviderBalanceUnlimited(provider.id);
        if (res.ok) {
          toast.success(tList("rechargeDialog.unlimitedSuccessTitle"), {
            description: tList("rechargeDialog.unlimitedSuccessDesc", {
              name: provider.name,
            }),
          });
          setOpenRecharge(false);
          setRechargeAmount("");
          router.refresh();
        } else {
          toast.error(tList("rechargeDialog.failedTitle"), {
            description: res.error || tList("unknownError"),
          });
        }
      } catch (error) {
        console.error("设置无限余额失败:", error);
        toast.error(tList("rechargeDialog.failedTitle"), {
          description: tList("rechargeDialog.errorDesc"),
        });
      }
    });
  };

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

            {/* Group Tag */}
            {provider.groupTag && (
              <Badge variant="outline" className="flex-shrink-0">
                {provider.groupTag}
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
            <div className="font-medium">{provider.priority}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{tList("weight")}</div>
            <div className="font-medium">{provider.weight}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{tList("costMultiplier")}</div>
            <div className="font-medium">{provider.costMultiplier}x</div>
          </div>
        </div>

        {/* 今日用量（仅大屏） */}
        <div className="hidden lg:block text-center flex-shrink-0 min-w-[100px]">
          <div className="text-xs text-muted-foreground">{tList("todayUsageLabel")}</div>
          <div className="font-medium">
            {tList("todayUsageCount", { count: provider.todayCallCount || 0 })}
          </div>
          <div className="text-xs font-mono text-muted-foreground mt-0.5">
            {formatCurrency(parseFloat(provider.todayTotalCostUsd || "0"), currencyCode)}
          </div>
        </div>

        {/* 余额显示（仅大屏） */}
        <div className="hidden xl:flex flex-col items-center flex-shrink-0 min-w-[120px]">
          <div className="text-xs text-muted-foreground mb-1">{tList("balance")}</div>
          <div className="flex items-center gap-1">
            {provider.balanceUsd === null ? (
              <Badge
                variant="secondary"
                className={`font-mono ${canEdit ? "cursor-pointer hover:bg-secondary/80" : ""}`}
                onClick={
                  canEdit
                    ? (e) => {
                        e.stopPropagation();
                        setOpenRecharge(true);
                      }
                    : undefined
                }
                title={canEdit ? tList("rechargeBalance") : undefined}
              >
                {tList("balanceUnlimited")}
              </Badge>
            ) : (
              <div className="flex items-center gap-1.5">
                <span
                  className={`font-mono font-medium ${
                    provider.balanceUsd < 0
                      ? "text-red-600"
                      : provider.balanceUsd === 0
                        ? "text-orange-600"
                        : provider.balanceUsd < 5
                          ? "text-yellow-600"
                          : "text-green-600"
                  } ${canEdit ? "cursor-pointer hover:underline" : ""}`}
                  onClick={
                    canEdit
                      ? (e) => {
                          e.stopPropagation();
                          setOpenRecharge(true);
                        }
                      : undefined
                  }
                  title={canEdit ? tList("rechargeBalance") : undefined}
                >
                  {provider.balanceUsd < 0 ? "-" : ""}$
                  {Math.abs(provider.balanceUsd).toFixed(2)}
                </span>
                {provider.balanceUsd < 0 && (
                  <Badge variant="destructive" className="text-xs px-1.5 py-0">
                    {tList("balanceOverdraft")}
                  </Badge>
                )}
                {provider.balanceUsd === 0 && (
                  <Badge variant="outline" className="text-xs px-1.5 py-0 text-orange-600 border-orange-600">
                    {tList("balanceExhausted")}
                  </Badge>
                )}
              </div>
            )}
          </div>
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
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <FormErrorBoundary>
            <ProviderForm
              mode="edit"
              provider={provider}
              onSuccess={() => {
                setOpenEdit(false);
                router.refresh();
              }}
              enableMultiProviderTypes={enableMultiProviderTypes}
            />
          </FormErrorBoundary>
        </DialogContent>
      </Dialog>

      {/* 克隆 Dialog */}
      <Dialog open={openClone} onOpenChange={setOpenClone}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <FormErrorBoundary>
            <ProviderForm
              mode="create"
              cloneProvider={provider}
              onSuccess={() => {
                setOpenClone(false);
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
              <Button onClick={handleCopy} disabled={!unmaskedKey} size="icon" variant="outline">
                {copied ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 余额充值 Dialog */}
      <Dialog open={openRecharge} onOpenChange={setOpenRecharge}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tList("rechargeDialog.title")}</DialogTitle>
            <DialogDescription>
              {tList("rechargeDialog.description", { name: provider.name })}{" "}
              {provider.balanceUsd === null ? (
                <span className="font-semibold">{tList("balanceUnlimited")}</span>
              ) : (
                <span className="font-semibold">${provider.balanceUsd.toFixed(2)}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="recharge-amount" className="text-sm font-medium">
                {tList("rechargeDialog.amountLabel")}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <input
                  id="recharge-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={rechargeAmount}
                  onChange={(e) => setRechargeAmount(e.target.value)}
                  className="w-full pl-7 pr-3 py-2 border rounded-md"
                  disabled={rechargePending}
                />
              </div>
              <p className="text-xs text-muted-foreground">{tList("rechargeDialog.amountDesc")}</p>
            </div>
            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                onClick={handleSetUnlimited}
                disabled={rechargePending}
                className="flex-1"
              >
                {tList("rechargeDialog.setUnlimited")}
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpenRecharge(false);
                    setRechargeAmount("");
                  }}
                  disabled={rechargePending}
                >
                  {tList("rechargeDialog.cancel")}
                </Button>
                <Button onClick={handleRecharge} disabled={rechargePending}>
                  {rechargePending ? tList("rechargeDialog.processing") : tList("rechargeDialog.submit")}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
