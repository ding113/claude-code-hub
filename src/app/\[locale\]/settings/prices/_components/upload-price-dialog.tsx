"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Upload, FileJson, CheckCircle, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { uploadPriceTable } from "@/actions/model-prices";
import { toast } from "sonner";
import type { PriceUpdateResult } from "@/types/model-price";

interface PageLoadingOverlayProps {
  active: boolean;
}

interface UploadPriceDialogProps {
  defaultOpen?: boolean;
  isRequired?: boolean;
}

function PageLoadingOverlay({ active }: PageLoadingOverlayProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !active) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex items-center gap-3 rounded-lg bg-card/90 px-5 py-4 shadow-lg ring-1 ring-border/40">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">正在更新模型价格...</span>
      </div>
    </div>,
    document.body
  );
}

/**
 * 价格表上传对话框组件
 */
export function UploadPriceDialog({
  defaultOpen = false,
  isRequired = false,
}: UploadPriceDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<PriceUpdateResult | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && uploading) {
      return;
    }

    if (!nextOpen) {
      setResult(null);
    }

    setOpen(nextOpen);
  };

  /**
   * 处理文件选择
   */
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    if (!file.name.endsWith(".json")) {
      toast.error("请选择JSON文件");
      return;
    }

    // 验证文件大小（限制10MB）
    if (file.size > 10 * 1024 * 1024) {
      toast.error("文件大小不能超过10MB");
      return;
    }

    setUploading(true);
    setResult(null);

    try {
      // 读取文件内容
      const text = await file.text();

      // 上传并处理
      const response = await uploadPriceTable(text);

      if (!response.ok) {
        toast.error(response.error);
        return;
      }

      if (!response.data) {
        toast.error("价格表更新成功但未返回处理结果");
        return;
      }

      setResult(response.data);
      toast.success("价格表更新成功");
    } catch (error) {
      console.error("更新失败:", error);
      toast.error("更新失败，请重试");
    } finally {
      setUploading(false);
      // 清除文件输入
      event.target.value = "";
    }
  };

  /**
   * 关闭对话框
   */
  const handleClose = () => {
    if (uploading) {
      return;
    }

    // 如果是必需上传且已成功上传，跳转到dashboard
    if (isRequired && result && (result.added.length > 0 || result.updated.length > 0)) {
      router.push("/dashboard");
      return;
    }

    setOpen(false);
    setResult(null);
  };

  return (
    <>
      <PageLoadingOverlay active={uploading} />
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={uploading}>
            <Upload className="h-4 w-4 mr-2" />
            更新价格表
          </Button>
        </DialogTrigger>
        <DialogContent
          className="max-w-lg"
          onEscapeKeyDown={(event) => {
            if (uploading) {
              event.preventDefault();
            }
          }}
          onPointerDownOutside={(event) => {
            if (uploading) {
              event.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{isRequired ? "更新模型价格表" : "更新模型价格表"}</DialogTitle>
            <DialogDescription>
              {isRequired
                ? "选择包含模型价格数据的 JSON 文件以更新价格表"
                : "选择包含模型价格数据的 JSON 文件以更新价格表"}
            </DialogDescription>
          </DialogHeader>

          {!result ? (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6">
                <div className="flex flex-col items-center space-y-3">
                  <FileJson className="h-10 w-10 text-muted-foreground/50" />
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">点击选择JSON文件或拖拽到此处</p>
                    <p className="text-xs text-muted-foreground mt-1">文件大小不超过10MB</p>
                  </div>
                  <label htmlFor="price-file-input">
                    <Button variant="secondary" size="sm" disabled={uploading} asChild>
                      <span>{uploading ? "更新中..." : "选择文件"}</span>
                    </Button>
                  </label>
                  <input
                    id="price-file-input"
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleFileSelect}
                    disabled={uploading}
                  />
                </div>
              </div>

              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  • 系统已内置 LiteLLM 价格表，如需更新可使用左侧&quot;同步 LiteLLM 价格&quot;按钮
                </p>
                <p>
                  • 也可以手动下载{" "}
                  <a
                    className="text-blue-500 underline"
                    href="https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    最新价格表
                  </a>{" "}
                  并通过此按钮更新
                </p>
                <p>• 支持 Claude 和 OpenAI 模型（claude-, gpt-, o1-, o3- 前缀）</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm space-y-2">
                <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                  <span>处理总数</span>
                  <span className="font-mono">{result.total}</span>
                </div>

                {result.added.length > 0 && (
                  <div className="p-2 bg-green-50 dark:bg-green-950/20 rounded">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="font-medium">新增模型 ({result.added.length})</span>
                    </div>
                    <div className="text-xs text-muted-foreground ml-6">
                      {result.added.slice(0, 3).join(", ")}
                      {result.added.length > 3 && ` 等${result.added.length}个`}
                    </div>
                  </div>
                )}

                {result.updated.length > 0 && (
                  <div className="p-2 bg-blue-50 dark:bg-blue-950/20 rounded">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertCircle className="h-4 w-4 text-blue-600" />
                      <span className="font-medium">更新模型 ({result.updated.length})</span>
                    </div>
                    <div className="text-xs text-muted-foreground ml-6">
                      {result.updated.slice(0, 3).join(", ")}
                      {result.updated.length > 3 && ` 等${result.updated.length}个`}
                    </div>
                  </div>
                )}

                {result.unchanged.length > 0 && (
                  <div className="p-2 bg-gray-50 dark:bg-gray-950/20 rounded">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">未变化 ({result.unchanged.length})</span>
                    </div>
                  </div>
                )}

                {result.failed.length > 0 && (
                  <div className="p-2 bg-red-50 dark:bg-red-950/20 rounded">
                    <div className="flex items-center gap-2 mb-1">
                      <XCircle className="h-4 w-4 text-red-600" />
                      <span className="font-medium">处理失败 ({result.failed.length})</span>
                    </div>
                    <div className="text-xs text-muted-foreground ml-6">
                      {result.failed.slice(0, 3).join(", ")}
                      {result.failed.length > 3 && ` 等${result.failed.length}个`}
                    </div>
                  </div>
                )}
              </div>

              <Button onClick={handleClose} className="w-full">
                {isRequired && result && (result.added.length > 0 || result.updated.length > 0)
                  ? "进入控制面板"
                  : "完成"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
