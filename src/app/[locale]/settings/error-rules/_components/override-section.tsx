"use client";

import { CheckCircle2, ChevronDown, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** JSON validation state type */
type JsonValidationState =
  | { state: "empty" }
  | { state: "valid" }
  | { state: "invalid"; message: string };

/** Claude format override response template */
const CLAUDE_OVERRIDE_TEMPLATE = `{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Your custom error message here"
  }
}`;

/** Gemini format override response template */
const GEMINI_OVERRIDE_TEMPLATE = `{
  "error": {
    "code": 400,
    "message": "Your custom error message here",
    "status": "INVALID_ARGUMENT"
  }
}`;

/** OpenAI format override response template */
const OPENAI_OVERRIDE_TEMPLATE = `{
  "error": {
    "message": "Your custom error message here",
    "type": "invalid_request_error",
    "param": null,
    "code": null
  }
}`;

/** Default override response template */
const DEFAULT_OVERRIDE_RESPONSE = CLAUDE_OVERRIDE_TEMPLATE;

interface OverrideSectionProps {
  /** Input ID prefix for add/edit dialogs */
  idPrefix: string;
  enableOverride: boolean;
  onEnableOverrideChange: (enabled: boolean) => void;
  overrideResponse: string;
  onOverrideResponseChange: (value: string) => void;
  overrideStatusCode: string;
  onOverrideStatusCodeChange: (value: string) => void;
}

export function OverrideSection({
  idPrefix,
  enableOverride,
  onEnableOverrideChange,
  overrideResponse,
  onOverrideResponseChange,
  overrideStatusCode,
  onOverrideStatusCodeChange,
}: OverrideSectionProps) {
  const t = useTranslations("settings");

  /** Real-time JSON format validation */
  const jsonStatus = useMemo((): JsonValidationState => {
    const trimmed = overrideResponse.trim();
    if (!trimmed) {
      return { state: "empty" };
    }
    try {
      JSON.parse(trimmed);
      return { state: "valid" };
    } catch (error) {
      return { state: "invalid", message: (error as Error).message };
    }
  }, [overrideResponse]);

  /** Handle use template button click */
  const handleUseTemplate = useCallback(
    (template: string) => {
      if (overrideResponse.trim().length > 0) {
        const confirmed = window.confirm(t("errorRules.dialog.useTemplateConfirm"));
        if (!confirmed) return;
      }
      onOverrideResponseChange(template);
    },
    [overrideResponse, onOverrideResponseChange, t]
  );

  return (
    <div className="rounded-xl bg-white/[0.02] border border-border/50 p-4 space-y-4">
      <div className="flex items-center space-x-2">
        <Checkbox
          id={`${idPrefix}-enableOverride`}
          checked={enableOverride}
          onCheckedChange={(checked) => onEnableOverrideChange(checked === true)}
        />
        <Label
          htmlFor={`${idPrefix}-enableOverride`}
          className="font-medium cursor-pointer text-sm"
        >
          {t("errorRules.dialog.enableOverride")}
        </Label>
      </div>
      <p className="text-xs text-muted-foreground">{t("errorRules.dialog.enableOverrideHint")}</p>

      {enableOverride && (
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor={`${idPrefix}-overrideResponse`}
                className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                {t("errorRules.dialog.overrideResponseLabel")}
              </Label>
              <div className="flex items-center gap-3">
                {/* JSON validation status indicator */}
                {jsonStatus.state === "valid" && (
                  <span className="flex items-center gap-1 text-xs text-green-400">
                    <CheckCircle2 className="h-3 w-3" />
                    {t("errorRules.dialog.validJson")}
                  </span>
                )}
                {jsonStatus.state === "invalid" && (
                  <span className="flex items-center gap-1 text-xs text-red-400">
                    <XCircle className="h-3 w-3" />
                    {t("errorRules.dialog.invalidJson")}
                  </span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs hover:bg-white/10"
                    >
                      {t("errorRules.dialog.useTemplate")}
                      <ChevronDown className="ml-1 h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => handleUseTemplate(CLAUDE_OVERRIDE_TEMPLATE)}>
                      Claude API
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleUseTemplate(GEMINI_OVERRIDE_TEMPLATE)}>
                      Gemini API
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleUseTemplate(OPENAI_OVERRIDE_TEMPLATE)}>
                      OpenAI API
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <textarea
              id={`${idPrefix}-overrideResponse`}
              value={overrideResponse}
              onChange={(e) => onOverrideResponseChange(e.target.value)}
              placeholder={DEFAULT_OVERRIDE_RESPONSE}
              rows={6}
              className={cn(
                "w-full bg-muted/50 border rounded-lg py-2.5 px-3 text-sm text-foreground font-mono",
                "placeholder:text-muted-foreground/50 resize-none",
                "focus:ring-1 outline-none transition-all",
                jsonStatus.state === "invalid"
                  ? "border-red-500/50 focus:border-red-500 focus:ring-red-500"
                  : "border-border focus:border-primary focus:ring-primary"
              )}
            />
            {/* JSON parse error details */}
            {jsonStatus.state === "invalid" && (
              <p className="text-xs text-red-400">{jsonStatus.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label
              htmlFor={`${idPrefix}-overrideStatusCode`}
              className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
            >
              {t("errorRules.dialog.overrideStatusCodeLabel")}
            </Label>
            <input
              id={`${idPrefix}-overrideStatusCode`}
              type="number"
              min={400}
              max={599}
              value={overrideStatusCode}
              onChange={(e) => onOverrideStatusCodeChange(e.target.value)}
              placeholder={t("errorRules.dialog.overrideStatusCodePlaceholder")}
              className={cn(
                "w-full bg-muted/50 border border-border rounded-lg py-2 px-3 text-sm text-foreground",
                "placeholder:text-muted-foreground/50",
                "focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              )}
            />
            <p className="text-xs text-muted-foreground">
              {t("errorRules.dialog.overrideStatusCodeHint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
