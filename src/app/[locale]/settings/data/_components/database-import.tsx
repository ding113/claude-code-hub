"use client";

import { AlertCircle, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ImportProgressEvent } from "@/types/database-backup";

export function DatabaseImport() {
  const t = useTranslations("settings.data.import");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [cleanFirst, setCleanFirst] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [progressMessages, setProgressMessages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressContainerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到最新进度
  useEffect(() => {
    if (progressContainerRef.current) {
      progressContainerRef.current.scrollTop = progressContainerRef.current.scrollHeight;
    }
  }, []);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".dump")) {
        toast.error(t("fileError"));
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleImportClick = () => {
    if (!selectedFile) {
      toast.error(t("noFileSelected"));
      return;
    }
    setShowConfirmDialog(true);
  };

  const handleConfirmImport = async () => {
    if (!selectedFile) return;

    setShowConfirmDialog(false);
    setIsImporting(true);
    setProgressMessages([]);

    try {
      // 构造表单数据
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("cleanFirst", cleanFirst.toString());

      // 调用导入 API（SSE 流式响应，自动携带 cookie）
      const response = await fetch("/api/admin/database/import", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t("failed"));
      }

      // Handle SSE stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error(t("streamError"));
      }

      let hasReceivedCompletion = false;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // 流正常结束，检查是否收到完成事件
          if (!hasReceivedCompletion) {
            setProgressMessages((prev) => [...prev, `⚠️ ${t("streamInterrupted")}`]);
            toast.warning(t("streamInterrupted"), {
              description: t("streamInterruptedDesc"),
              duration: 6000,
            });
          }
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data: ImportProgressEvent = JSON.parse(line.slice(6));

              if (data.type === "progress") {
                setProgressMessages((prev) => [...prev, data.message]);
              } else if (data.type === "complete") {
                hasReceivedCompletion = true;
                setProgressMessages((prev) => [...prev, `✅ ${data.message}`]);

                // 检查是否有警告（exitCode 非 0 表示有可忽略错误）
                if (data.exitCode && data.exitCode !== 0) {
                  toast.success(t("successWithWarnings"), {
                    description: t("successWithWarningsDesc"),
                    duration: 6000,
                  });
                } else {
                  toast.success(t("successMessage"), {
                    description: cleanFirst ? t("successCleanModeDesc") : t("successMergeModeDesc"),
                    duration: 5000,
                  });
                }
              } else if (data.type === "error") {
                hasReceivedCompletion = true;
                setProgressMessages((prev) => [...prev, `❌ ${data.message}`]);

                // 显示详细错误信息
                toast.error(t("failedMessage"), {
                  description: data.message,
                  duration: 8000,
                });
              }
            } catch (parseError) {
              console.error("Parse SSE error:", parseError);
              // 解析错误也要通知用户
              toast.error(t("parseError"), {
                description: String(parseError),
              });
            }
          }
        }
      }

      // 清空文件选择
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      console.error("Import error:", error);
      toast.error(error instanceof Error ? error.message : t("error"));
      setProgressMessages((prev) => [
        ...prev,
        `❌ ${t("error")}: ${error instanceof Error ? error.message : t("errorUnknown")}`,
      ]);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("descriptionFull")}</p>

      {/* File selection */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="backup-file">{t("selectFileLabel")}</Label>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            id="backup-file"
            type="file"
            accept=".dump"
            onChange={handleFileChange}
            disabled={isImporting}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        {selectedFile && (
          <p className="text-xs text-muted-foreground">
            {t("fileSelected", {
              name: selectedFile.name,
              size: (selectedFile.size / 1024 / 1024).toFixed(2),
            })}
          </p>
        )}
      </div>

      {/* Import options */}
      <div className="flex items-start gap-2">
        <Checkbox
          id="clean-first"
          checked={cleanFirst}
          onCheckedChange={(checked: boolean) => setCleanFirst(checked === true)}
          disabled={isImporting}
        />
        <div className="grid gap-1.5 leading-none">
          <Label
            htmlFor="clean-first"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            {t("cleanFirstLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("cleanFirstDescription")}</p>
        </div>
      </div>

      {/* Import button */}
      <Button
        onClick={handleImportClick}
        disabled={!selectedFile || isImporting}
        className="w-full sm:w-auto"
      >
        <Upload className="mr-2 h-4 w-4" />
        {isImporting ? t("importing") : t("button")}
      </Button>

      {/* Progress display */}
      {progressMessages.length > 0 && (
        <div className="mt-2 rounded-md border border-border bg-muted/30 p-3">
          <h3 className="text-sm font-medium mb-2">{t("progressTitle")}</h3>
          <div
            ref={progressContainerRef}
            className="max-h-60 overflow-y-auto rounded bg-background p-2 font-mono text-xs space-y-1"
          >
            {progressMessages.map((message, index) => (
              <div key={index} className="text-muted-foreground">
                {message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-500" />
              {t("confirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-muted-foreground text-sm space-y-2">
                <p>{cleanFirst ? t("confirmOverwrite") : t("confirmMerge")}</p>
                <p className="font-semibold text-foreground">
                  {cleanFirst ? t("warningOverwrite") : t("warningMerge")}
                </p>
                <p>
                  {t("backupFile")} <span className="font-mono text-xs">{selectedFile?.name}</span>
                </p>
                <p className="text-xs text-muted-foreground">{t("backupRecommendation")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmImport}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
