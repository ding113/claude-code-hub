import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MixedValueIndicatorProps {
  values?: unknown[]; // 可选：显示所有不同的值
}

function formatValueForDisplay(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function MixedValueIndicator({ values }: MixedValueIndicatorProps) {
  const t = useTranslations("settings.providers.batchEdit");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-muted-foreground text-sm">
            <Info className="h-3 w-3" />
            {t("mixedValues.label")}
          </span>
        </TooltipTrigger>
        {values && values.length > 0 && (
          <TooltipContent>
            <div className="space-y-1">
              <p className="font-medium">{t("mixedValues.tooltip")}</p>
              <ul className="list-disc list-inside text-xs">
                {values.slice(0, 5).map((v, i) => (
                  <li key={i}>{formatValueForDisplay(v)}</li>
                ))}
                {values.length > 5 && (
                  <li>{t("mixedValues.andMore", { count: values.length - 5 })}</li>
                )}
              </ul>
            </div>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}
