"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  XCircle,
  Edit,
  Copy,
  Trash,
  Globe,
  Key,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import type { ProviderDisplay } from "@/types/provider";
import type { User } from "@/types/user";
import { getProviderTypeConfig } from "@/lib/provider-type-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ProviderForm } from "./forms/provider-form";
import { FormErrorBoundary } from "@/components/form-error-boundary";
import { getUnmaskedProviderKey, resetProviderCircuit, removeProvider } from "@/actions/providers";
import { toast } from "sonner";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
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
import { Switch } from "@/components/ui/switch";
import { editProvider } from "@/actions/providers";

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
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [unmaskedKey, setUnmaskedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resetPending, startResetTransition] = useTransition();
  const [deletePending, startDeleteTransition] = useTransition();
  const [togglePending, startToggleTransition] = useTransition();

  const canEdit = currentUser?.role === "admin";

  // 获取供应商类型配置
  const typeConfig = getProviderTypeConfig(provider.providerType);
  const TypeIcon = typeConfig.icon;

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
            toast.success("删除成功", {
              description: `供应商 "${provider.name}" 已删除`,
            });
            router.refresh();
          } else {
            toast.error("删除失败", {
              description: res.error || "未知错误",
            });
          }
        } catch (error) {
          console.error("删除供应商失败:", error);
          toast.error("删除失败", {
            description: "操作过程中出现异常",
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
      toast.error("获取密钥失败", {
        description: result.error || "未知错误",
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
        toast.success("密钥已复制到剪贴板");
        setTimeout(() => setCopied(false), 3000);
      } catch (error) {
        console.error("复制失败:", error);
        toast.error("复制失败");
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
          toast.success("熔断器已重置", {
            description: `供应商 "${provider.name}" 的熔断状态已解除`,
          });
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

  // 处理启用/禁用切换
  const handleToggle = () => {
    startToggleTransition(async () => {
      try {
        const res = await editProvider(provider.id, {
          is_enabled: !provider.isEnabled,
        });
        if (res.ok) {
          toast.success(`供应商已${!provider.isEnabled ? "启用" : "禁用"}`, {
            description: `供应商 "${provider.name}" 状态已更新`,
          });
          router.refresh();
        } else {
          toast.error("状态切换失败", {
            description: res.error || "未知错误",
          });
        }
      } catch (error) {
        console.error("状态切换失败:", error);
        toast.error("状态切换失败", {
          description: "操作过程中出现异常",
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
          >
            <TypeIcon className="h-3.5 w-3.5" />
          </div>
        </div>

        {/* 中间：名称、URL、官网、tag、熔断状态 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Favicon */}
            {provider.faviconUrl && (
              <img
                src={provider.faviconUrl}
                alt=""
                className="h-4 w-4 flex-shrink-0"
                onError={(e) => {
                  // 隐藏加载失败的图标
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
                熔断中
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
                官网
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
          </div>
        </div>

        {/* 右侧：指标（仅桌面端） */}
        <div className="hidden md:grid grid-cols-3 gap-4 text-center flex-shrink-0">
          <div>
            <div className="text-xs text-muted-foreground">优先级</div>
            <div className="font-medium">{provider.priority}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">权重</div>
            <div className="font-medium">{provider.weight}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">成本倍数</div>
            <div className="font-medium">{provider.costMultiplier}x</div>
          </div>
        </div>

        {/* 今日用量（仅大屏） */}
        <div className="hidden lg:block text-center flex-shrink-0 w-20">
          <div className="text-xs text-muted-foreground">今日用量</div>
          <div className="font-medium">{provider.todayCallCount || 0}</div>
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
                  <AlertDialogTitle>确认删除供应商？</AlertDialogTitle>
                  <AlertDialogDescription>
                    确定要删除供应商 &quot;{provider.name}&quot; 吗？此操作无法撤销。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex justify-end gap-2">
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete();
                    }}
                    className="bg-red-600 hover:bg-red-700"
                    disabled={deletePending}
                  >
                    删除
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* 编辑 Dialog */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
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
            <DialogTitle>查看完整 API Key</DialogTitle>
            <DialogDescription>请妥善保管，不要泄露给他人</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono bg-muted px-3 py-2 rounded text-sm break-all">
                {unmaskedKey || "加载中..."}
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
    </>
  );
}
