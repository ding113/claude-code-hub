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
    onChange(e.target.value);
  };

  const handleMaxOut = () => {
    onChange("32000");
  };

  return (
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
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t(`${prefix}.help`)}
            className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Info className="h-4 w-4 shrink-0" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4} className="max-w-xs">
          <p className="leading-relaxed">{t(`${prefix}.help`)}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
