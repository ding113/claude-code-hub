"use client";

import { AlertCircle, CheckCircle, FileJson, Loader2, Upload, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { uploadPriceTable } from "@/actions/model-prices";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { PriceUpdateResult } from "@/types/model-price";

interface PageLoadingOverlayProps {
  active: boolean;
}

interface UploadPriceDialogProps {
  defaultOpen?: boolean;
  isRequired?: boolean;
}

function PageLoadingOverlay({ active }: PageLoadingOverlayProps) {
  const t = useTranslations("settings.prices");
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
        <span className="text-sm text-muted-foreground">{t("dialog.updating")}</span>
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
  const t = useTranslations("settings.prices");
  const tCommon = useTranslations("settings.common");
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<PriceUpdateResult | null>(null);
  const [cloudModelCount, setCloudModelCount] = useState<number | null>(null);
  const [cloudModelCountStatus, setCloudModelCountStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && uploading) {
      return;
    }

    if (!nextOpen) {
      setResult(null);
    }

    setOpen(nextOpen);
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const fetchCloudModelCount = async () => {
      setCloudModelCountStatus("loading");
      try {
        const response = await fetch("/api/prices/cloud-model-count", { cache: "no-store" });
        const payload = await response.json();
        if (!payload?.ok) {
          throw new Error(payload?.error || "unknown error");
        }

        if (!cancelled) {
          setCloudModelCount(Number(payload.data?.count) || 0);
          setCloudModelCountStatus("loaded");
        }
      } catch (error) {
        console.error("获取云端模型数量失败:", error);
        if (!cancelled) {
          setCloudModelCount(null);
          setCloudModelCountStatus("error");
        }
      }
    };

    fetchCloudModelCount();

    return () => {
      cancelled = true;
    };
  }, [open]);

  /**
   * 处理文件选择
   */
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".json") && !lowerName.endsWith(".toml")) {
      toast.error(t("dialog.invalidFileType"));
      return;
    }

    // 验证文件大小（限制10MB）
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("dialog.fileTooLarge"));
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
        console.error("价格表上传失败:", response.error);
        toast.error(t("dialog.updateFailed"));
        return;
      }

      if (!response.data) {
        toast.error(t("dialog.updateFailed"));
        return;
      }

      setResult(response.data);
      const totalUpdates = response.data.added.length + response.data.updated.length;
      toast.success(t("dialog.updateSuccess", { count: totalUpdates }));
      window.dispatchEvent(new Event("price-data-updated"));
    } catch (error) {
      console.error("更新失败:", error);
      toast.error(t("dialog.updateFailed"));
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
            {t("dialog.updatePriceTable")}
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
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
          </DialogHeader>

          {!result ? (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6">
                <div className="flex flex-col items-center space-y-3">
                  <FileJson className="h-10 w-10 text-muted-foreground/50" />
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">{t("dialog.selectFile")}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("dialog.fileSizeLimitSmall")}
                    </p>
                  </div>
                  <label htmlFor="price-file-input">
                    <Button variant="secondary" size="sm" disabled={uploading} asChild>
                      <span>{uploading ? t("dialog.updating") : t("dialog.selectJson")}</span>
                    </Button>
                  </label>
                  <input
                    id="price-file-input"
                    type="file"
                    accept=".json,.toml"
                    className="hidden"
                    onChange={handleFileSelect}
                    disabled={uploading}
                  />
                </div>
              </div>

              <div className="text-xs text-muted-foreground space-y-1">
                <p>• {t("dialog.systemHasBuiltIn")}</p>
                <p>
                  • {t("dialog.manualDownload")}{" "}
                  <a
                    className="text-blue-500 underline"
                    href="https://claude-code-hub.app/config/prices-base.toml"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("dialog.latestPriceTable")}
                  </a>{" "}
                  {t("dialog.andUploadViaButton")}
                </p>
                <p>
                  •{" "}
                  {cloudModelCountStatus === "loading"
                    ? t("dialog.cloudModelCountLoading")
                    : cloudModelCountStatus === "loaded"
                      ? t("dialog.supportedModels", { count: cloudModelCount ?? 0 })
                      : cloudModelCountStatus === "error"
                        ? t("dialog.cloudModelCountFailed")
                        : t("dialog.supportedModels", { count: "-" })}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm space-y-2">
                <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                  <span>{t("dialog.results.total", { total: result.total })}</span>
                  <span className="font-mono">{result.total}</span>
                </div>

                {result.added.length > 0 && (
                  <div className="p-2 bg-green-50 dark:bg-green-950/20 rounded">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="font-medium">
                        {t("dialog.results.success", { success: result.added.length })}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground ml-6">
                      {result.added.slice(0, 3).join(", ")}
                      {result.added.length > 3 &&
                        t("dialog.results.more", { count: result.added.length - 3 })}
                    </div>
                  </div>
                )}

                {result.updated.length > 0 && (
                  <div className="p-2 bg-blue-50 dark:bg-blue-950/20 rounded">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertCircle className="h-4 w-4 text-blue-600" />
                      <span className="font-medium">
                        {t("dialog.results.success", { success: result.updated.length })}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground ml-6">
                      {result.updated.slice(0, 3).join(", ")}
                      {result.updated.length > 3 &&
                        t("dialog.results.more", { count: result.updated.length - 3 })}
                    </div>
                  </div>
                )}

                {result.unchanged.length > 0 && (
                  <div className="p-2 bg-gray-50 dark:bg-gray-950/20 rounded">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {t("dialog.results.skipped", { skipped: result.unchanged.length })}
                      </span>
                    </div>
                  </div>
                )}

                {result.failed.length > 0 && (
                  <div className="p-2 bg-red-50 dark:bg-red-950/20 rounded">
                    <div className="flex items-center gap-2 mb-1">
                      <XCircle className="h-4 w-4 text-red-600" />
                      <span className="font-medium">
                        {t("dialog.results.failed", { failed: result.failed.length })}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground ml-6">
                      {result.failed.slice(0, 3).join(", ")}
                      {result.failed.length > 3 &&
                        t("dialog.results.more", { count: result.failed.length - 3 })}
                    </div>
                  </div>
                )}
              </div>

              <Button onClick={handleClose} className="w-full">
                {isRequired && result && (result.added.length > 0 || result.updated.length > 0)
                  ? tCommon("confirm")
                  : tCommon("completed")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
