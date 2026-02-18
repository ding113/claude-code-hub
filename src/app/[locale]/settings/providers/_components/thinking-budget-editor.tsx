"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ThinkingBudgetEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ThinkingBudgetEditor({
  value,
  onChange,
  disabled = false,
}: ThinkingBudgetEditorProps) {
  const t = useTranslations("settings.providers.form");
  const prefix = "sections.routing.anthropicOverrides.thinkingBudget";

  const mode = value === "inherit" ? "inherit" : "custom";

  const handleModeChange = (val: string) => {
    if (val === "inherit") {
      onChange("inherit");
    } else {
      onChange("10240");
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === "") {
      onChange("inherit");
    } else {
      onChange(val);
    }
  };

  const handleMaxOut = () => {
    onChange("32000");
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex gap-2 items-center">
          <Select value={mode} onValueChange={handleModeChange} disabled={disabled}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">{t(`${prefix}.options.inherit`)}</SelectItem>
              <SelectItem value="custom">{t(`${prefix}.options.custom`)}</SelectItem>
            </SelectContent>
          </Select>
          {mode !== "inherit" && (
            <>
              <Input
                type="number"
                value={value}
                onChange={handleInputChange}
                placeholder={t(`${prefix}.placeholder`)}
                disabled={disabled}
                min="1024"
                max="32000"
                className="flex-1"
              />
              <button
                type="button"
                onClick={handleMaxOut}
                className="px-3 py-2 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded-md transition-colors whitespace-nowrap"
                disabled={disabled}
              >
                {t(`${prefix}.maxOutButton`)}
              </button>
            </>
          )}
          <Info className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="text-sm">{t(`${prefix}.help`)}</p>
      </TooltipContent>
    </Tooltip>
  );
}
