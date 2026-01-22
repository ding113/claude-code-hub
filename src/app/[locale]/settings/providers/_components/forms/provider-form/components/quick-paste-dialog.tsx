"use client";

import { AlertCircle, Check, ClipboardPaste } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { readFromClipboard } from "@/lib/utils/clipboard";
import {
  generateRandomSuffix,
  isValidApiKeyFormat,
  type ParsedProviderInfo,
  parseProviderText,
} from "@/lib/utils/provider-text-parser";
import { isValidUrl, maskKey } from "@/lib/utils/validation";
import { useProviderForm } from "../provider-form-context";

interface QuickPasteDialogProps {
  disabled?: boolean;
}

export function QuickPasteDialog({ disabled }: QuickPasteDialogProps) {
  const t = useTranslations("settings.providers.form.quickPaste");
  const { dispatch, mode } = useProviderForm();

  const [open, setOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<ParsedProviderInfo | null>(null);
  const [generatedSuffix, setGeneratedSuffix] = useState("");

  useEffect(() => {
    if (open) {
      setGeneratedSuffix(generateRandomSuffix());
    }
  }, [open]);

  const handleOpenChange = useCallback(async (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen) {
      try {
        const clipboardText = await readFromClipboard();
        if (clipboardText) {
          setRawText(clipboardText);
          setParsed(parseProviderText(clipboardText));
        }
      } catch {
        // ignore clipboard read errors
      }
    } else {
      setRawText("");
      setParsed(null);
    }
  }, []);

  const handleTextChange = useCallback((text: string) => {
    setRawText(text);
    if (text.trim()) {
      setParsed(parseProviderText(text));
    } else {
      setParsed(null);
    }
  }, []);

  const handleConfirm = useCallback(() => {
    if (!parsed) return;

    const finalName = parsed.name
      ? `${parsed.name}_${generatedSuffix}`
      : `Provider_${generatedSuffix}`;

    dispatch({ type: "SET_NAME", payload: finalName });
    if (parsed.url) {
      dispatch({ type: "SET_URL", payload: parsed.url });
    }
    if (parsed.key) {
      dispatch({ type: "SET_KEY", payload: parsed.key });
    }
    dispatch({ type: "SET_PROVIDER_TYPE", payload: parsed.providerType });

    setOpen(false);
  }, [parsed, generatedSuffix, dispatch]);

  const isUrlValid = parsed?.url ? isValidUrl(parsed.url) : false;
  const isKeyValid = parsed?.key ? isValidApiKeyFormat(parsed.key) : false;
  const canConfirm = parsed && (isUrlValid || isKeyValid);

  if (mode === "edit") return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} className="gap-1.5">
          <ClipboardPaste className="h-4 w-4" />
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Textarea
              value={rawText}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder={t("placeholder")}
              rows={6}
              className="font-mono text-sm"
            />
          </div>

          {parsed && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="text-sm font-medium">{t("preview")}</div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16">{t("type")}:</span>
                <Badge variant="secondary">{parsed.providerType}</Badge>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16">{t("name")}:</span>
                <span className="text-sm font-mono">
                  {parsed.name || "Provider"}_{generatedSuffix}
                </span>
                {parsed.confidence.name && <Check className="h-3 w-3 text-green-500" />}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16">{t("url")}:</span>
                {parsed.url ? (
                  <>
                    <span className="text-sm font-mono truncate max-w-[280px]">{parsed.url}</span>
                    {isUrlValid ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <AlertCircle className="h-3 w-3 text-yellow-500" />
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground italic">{t("notFound")}</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16">{t("key")}:</span>
                {parsed.key ? (
                  <>
                    <span className="text-sm font-mono">{maskKey(parsed.key)}</span>
                    {isKeyValid ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <AlertCircle className="h-3 w-3 text-yellow-500" />
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground italic">{t("notFound")}</span>
                )}
              </div>
            </div>
          )}

          {rawText && !parsed && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              {t("parseError")}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
