"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { KeyDialogUserContext } from "@/types/user";
import { AddKeyForm } from "./forms/add-key-form";

export interface AddKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: number;
  user?: KeyDialogUserContext;
  isAdmin?: boolean;
  onSuccess?: () => void;
}

interface GeneratedKeyInfo {
  generatedKey: string;
  name: string;
}

export function AddKeyDialog({
  open,
  onOpenChange,
  userId,
  user,
  isAdmin,
  onSuccess,
}: AddKeyDialogProps) {
  const t = useTranslations("dashboard.addKeyForm");
  const tCommon = useTranslations("common");
  const [generatedKey, setGeneratedKey] = useState<GeneratedKeyInfo | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSuccess = (result: GeneratedKeyInfo) => {
    setGeneratedKey(result);
    onSuccess?.();
  };

  const handleCopy = async () => {
    if (!generatedKey) return;
    try {
      await navigator.clipboard.writeText(generatedKey.generatedKey);
      setCopied(true);
      toast.success(tCommon("copySuccess"));
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("[AddKeyDialog] copy failed", error);
      toast.error(tCommon("copyFailed"));
    }
  };

  const handleClose = () => {
    setGeneratedKey(null);
    setCopied(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {generatedKey ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("successTitle")}</DialogTitle>
              <DialogDescription>{t("successDescription")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>{t("keyName.label")}</Label>
                <Input value={generatedKey.name} readOnly className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label>{t("generatedKey.label")}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={generatedKey.generatedKey}
                    readOnly
                    className="font-mono bg-muted"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleCopy}
                    className="shrink-0"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("generatedKey.hint")}</p>
              </div>
              <div className="flex justify-end pt-4">
                <Button type="button" onClick={handleClose}>
                  {tCommon("close")}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>
            <AddKeyForm userId={userId} user={user} isAdmin={isAdmin} onSuccess={handleSuccess} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
