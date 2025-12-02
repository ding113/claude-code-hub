"use client";

import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function LogCleanupPanel() {
  const t = useTranslations("settings.data.cleanup");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<string>("30");
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const fetchPreview = useCallback(async () => {
    setIsPreviewLoading(true);

    try {
      const beforeDate = new Date();
      beforeDate.setDate(beforeDate.getDate() - parseInt(timeRange, 10));

      const response = await fetch("/api/admin/log-cleanup/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          beforeDate: beforeDate.toISOString(),
          dryRun: true,
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setPreviewCount(result.totalDeleted);
      } else {
        console.error("Preview error:", result.error);
        setPreviewCount(null);
      }
    } catch (error) {
      console.error("Preview error:", error);
      setPreviewCount(null);
    } finally {
      setIsPreviewLoading(false);
    }
  }, [timeRange]);

  // 当对话框打开时，自动预览
  useEffect(() => {
    if (isOpen) {
      fetchPreview();
    } else {
      setPreviewCount(null);
    }
  }, [isOpen, fetchPreview]);

  const handleCleanup = async () => {
    setIsLoading(true);

    try {
      const beforeDate = new Date();
      beforeDate.setDate(beforeDate.getDate() - parseInt(timeRange, 10));

      const response = await fetch("/api/admin/log-cleanup/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          beforeDate: beforeDate.toISOString(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || t("failed"));
      }

      if (result.success) {
        toast.success(
          t("successMessage", {
            count: result.totalDeleted.toLocaleString(),
            batches: result.batchCount,
            duration: (result.durationMs / 1000).toFixed(2),
          })
        );
        setIsOpen(false);
      } else {
        toast.error(result.error || t("failed"));
      }
    } catch (error) {
      console.error("Cleanup error:", error);
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setIsLoading(false);
    }
  };

  const getTimeRangeDescription = () => {
    const days = parseInt(timeRange, 10);
    if (days === 7) return t("rangeDescription.7days");
    if (days === 30) return t("rangeDescription.30days");
    if (days === 90) return t("rangeDescription.90days");
    if (days === 180) return t("rangeDescription.180days");
    return t("rangeDescription.default", { days });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t("descriptionWarning").split("注意：")[0]}
        <strong>
          {t("descriptionWarning").includes("注意：")
            ? t("descriptionWarning").split("注意：")[1]
            : ""}
        </strong>
      </p>

      <div className="flex flex-col gap-3">
        <Label htmlFor="time-range">{t("rangeLabel")}</Label>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger id="time-range" className="w-full sm:w-[300px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">{t("range.7days")}</SelectItem>
            <SelectItem value="30">{t("range.30days")}</SelectItem>
            <SelectItem value="90">{t("range.90days")}</SelectItem>
            <SelectItem value="180">{t("range.180days")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t("willClean", { range: getTimeRangeDescription() })}
        </p>
      </div>

      <Button onClick={() => setIsOpen(true)} variant="destructive" className="w-full sm:w-auto">
        <Trash2 className="mr-2 h-4 w-4" />
        {t("button")}
      </Button>

      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("confirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>{t("confirmWarning", { range: getTimeRangeDescription() })}</p>

              {/* Preview info */}
              <div className="bg-muted p-3 rounded-md">
                {isPreviewLoading ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t("previewLoading")}</span>
                  </div>
                ) : previewCount !== null ? (
                  <p className="text-sm font-medium">
                    {t("previewCount", { count: previewCount.toLocaleString() }).split(" ")[0]}{" "}
                    <span className="text-destructive text-lg">
                      {previewCount.toLocaleString()}
                    </span>{" "}
                    {t("previewCount", { count: previewCount.toLocaleString() })
                      .split(" ")
                      .slice(-2)
                      .join(" ")}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("previewError")}</p>
                )}
              </div>

              <p className="text-sm">
                {t("statisticsRetained")}
                <br />
                {t("logsDeleted")}
              </p>
              <p className="text-sm text-muted-foreground">{t("backupRecommendation")}</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleCleanup();
              }}
              disabled={isLoading || isPreviewLoading}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("cleaning")}
                </>
              ) : (
                t("confirm")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
