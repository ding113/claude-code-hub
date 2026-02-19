"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ExportMode = "full" | "excludeLogs" | "ledgerOnly";

const EXPORT_MODES: ExportMode[] = ["full", "excludeLogs", "ledgerOnly"];

export function DatabaseExport() {
  const t = useTranslations("settings.data.export");
  const [isExporting, setIsExporting] = useState(false);
  const [exportMode, setExportMode] = useState<ExportMode>("full");

  const handleExport = async () => {
    setIsExporting(true);

    try {
      const response = await fetch(`/api/admin/database/export?mode=${exportMode}`, {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t("failed"));
      }

      const contentDisposition = response.headers.get("Content-Disposition");
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || `backup_${new Date().toISOString()}.dump`;

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success(t("successMessage"));
    } catch (error) {
      console.error("Export error:", error);
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("descriptionFull")}</p>

      <div className="flex flex-col gap-2">
        <Select value={exportMode} onValueChange={(v) => setExportMode(v as ExportMode)}>
          <SelectTrigger className="w-full sm:w-[280px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPORT_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                <div className="flex flex-col">
                  <span>{t(`mode.${mode}`)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(`modeDescription.${mode}`)}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        onClick={handleExport}
        disabled={isExporting}
        className="w-full sm:w-auto bg-[#E25706] hover:bg-[#E25706]/90 text-white"
      >
        <Download className="mr-2 h-4 w-4" />
        {isExporting ? t("exporting") : t("button")}
      </Button>
    </div>
  );
}
