"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function DatabaseExport() {
  const t = useTranslations("settings.data.export");
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);

    try {
      // Call export API (auto includes cookie)
      const response = await fetch("/api/admin/database/export", {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t("failed"));
      }

      // Get filename (from Content-Disposition header)
      const contentDisposition = response.headers.get("Content-Disposition");
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || `backup_${new Date().toISOString()}.dump`;

      // Download file
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

      <Button onClick={handleExport} disabled={isExporting} className="w-full sm:w-auto">
        <Download className="mr-2 h-4 w-4" />
        {isExporting ? t("exporting") : t("button")}
      </Button>
    </div>
  );
}
