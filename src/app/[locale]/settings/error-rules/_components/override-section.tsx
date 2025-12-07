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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** JSON 验证状态类型 */
type JsonValidationState =
  | { state: "empty" }
  | { state: "valid" }
  | { state: "invalid"; message: string };

/** Claude 格式的覆写响应模板 */
const CLAUDE_OVERRIDE_TEMPLATE = `{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Your custom error message here"
  }
}`;

/** Gemini 格式的覆写响应模板 */
const GEMINI_OVERRIDE_TEMPLATE = `{
  "error": {
    "code": 400,
    "message": "Your custom error message here",
    "status": "INVALID_ARGUMENT"
  }
}`;

/** OpenAI 格式的覆写响应模板 */
const OPENAI_OVERRIDE_TEMPLATE = `{
  "error": {
    "message": "Your custom error message here",
    "type": "invalid_request_error",
    "param": null,
    "code": null
  }
}`;

/** 默认的覆写响应模板（保持向后兼容） */
const DEFAULT_OVERRIDE_RESPONSE = CLAUDE_OVERRIDE_TEMPLATE;

interface OverrideSectionProps {
  /** 输入框 ID 前缀，用于区分 add/edit 对话框 */
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

  /** 实时 JSON 格式验证 */
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

  /** 处理使用模板按钮点击 */
  const handleUseTemplate = useCallback(
    (template: string) => {
      // 如果输入框已有内容，弹出确认对话框
      if (overrideResponse.trim().length > 0) {
        const confirmed = window.confirm(t("errorRules.dialog.useTemplateConfirm"));
        if (!confirmed) return;
      }
      onOverrideResponseChange(template);
    },
    [overrideResponse, onOverrideResponseChange, t]
  );

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center space-x-2">
        <Checkbox
          id={`${idPrefix}-enableOverride`}
          checked={enableOverride}
          onCheckedChange={(checked) => onEnableOverrideChange(checked === true)}
        />
        <Label htmlFor={`${idPrefix}-enableOverride`} className="font-medium cursor-pointer">
          {t("errorRules.dialog.enableOverride")}
        </Label>
      </div>
      <p className="text-xs text-muted-foreground">{t("errorRules.dialog.enableOverrideHint")}</p>

      {enableOverride && (
        <div className="space-y-4 pt-2">
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={`${idPrefix}-overrideResponse`}>
                {t("errorRules.dialog.overrideResponseLabel")}
              </Label>
              <div className="flex items-center gap-3">
                {/* JSON 验证状态指示器 */}
                {jsonStatus.state === "valid" && (
                  <span className="flex items-center gap-1 text-xs text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" />
                    {t("errorRules.dialog.validJson")}
                  </span>
                )}
                {jsonStatus.state === "invalid" && (
                  <span className="flex items-center gap-1 text-xs text-destructive">
                    <XCircle className="h-3 w-3" />
                    {t("errorRules.dialog.invalidJson")}
                  </span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="h-6 text-xs">
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
            <Textarea
              id={`${idPrefix}-overrideResponse`}
              value={overrideResponse}
              onChange={(e) => onOverrideResponseChange(e.target.value)}
              placeholder={DEFAULT_OVERRIDE_RESPONSE}
              rows={6}
              className={`font-mono text-sm ${jsonStatus.state === "invalid" ? "border-destructive" : ""}`}
            />
            {/* JSON 解析错误详情 */}
            {jsonStatus.state === "invalid" && (
              <p className="text-xs text-destructive">{jsonStatus.message}</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${idPrefix}-overrideStatusCode`}>
              {t("errorRules.dialog.overrideStatusCodeLabel")}
            </Label>
            <Input
              id={`${idPrefix}-overrideStatusCode`}
              type="number"
              min={400}
              max={599}
              value={overrideStatusCode}
              onChange={(e) => onOverrideStatusCodeChange(e.target.value)}
              placeholder={t("errorRules.dialog.overrideStatusCodePlaceholder")}
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
