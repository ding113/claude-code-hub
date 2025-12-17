"use client";

import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface KeyFullDisplayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyName: string;
  fullKey: string;
}

export function KeyFullDisplayDialog({
  open,
  onOpenChange,
  keyName,
  fullKey,
}: KeyFullDisplayDialogProps) {
  const t = useTranslations("dashboard.userManagement.keyFullDisplay");
  const tCommon = useTranslations("common");
  const [isVisible, setIsVisible] = useState(true);
  const [copied, setCopied] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setIsVisible(true);
      setCopied(false);
    }
  }, [open]);

  const displayKey = isVisible ? fullKey : fullKey.replace(/./g, "*");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullKey);
      setCopied(true);
      toast.success(t("copySuccess"));
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("[KeyFullDisplayDialog] copy failed", error);
      toast.error(t("copyFailed"));
    }
  };

  const handleClose = () => {
    setIsVisible(false);
    setCopied(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{keyName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <div
              className={cn(
                "min-h-[80px] p-4 rounded-lg border bg-muted/50 font-mono text-sm break-all",
                isVisible ? "select-all" : ""
              )}
            >
              {displayKey}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2"
              onClick={() => setIsVisible(!isVisible)}
              aria-label={isVisible ? t("hide") : t("show")}
            >
              {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={handleCopy}>
              {copied ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  {t("copied")}
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  {t("copy")}
                </>
              )}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            {tCommon("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
