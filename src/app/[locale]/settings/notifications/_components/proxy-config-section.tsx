"use client";

import { ChevronDown, ChevronRight, Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface ProxyConfigSectionProps {
  proxyUrl: string;
  proxyFallbackToDirect: boolean;
  onProxyUrlChange: (value: string) => void;
  onProxyFallbackToDirectChange: (value: boolean) => void;
}

export function ProxyConfigSection({
  proxyUrl,
  proxyFallbackToDirect,
  onProxyUrlChange,
  onProxyFallbackToDirectChange,
}: ProxyConfigSectionProps) {
  const t = useTranslations("settings");
  const [open, setOpen] = useState(Boolean(proxyUrl));

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Globe className="h-4 w-4" />
          {t("notifications.targetDialog.proxy.title")}
        </div>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="sr-only">{t("notifications.targetDialog.proxy.toggle")}</span>
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="mt-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="proxyUrl">{t("notifications.targetDialog.proxy.url")}</Label>
          <Input
            id="proxyUrl"
            value={proxyUrl}
            onChange={(e) => onProxyUrlChange(e.target.value)}
            placeholder={t("notifications.targetDialog.proxy.urlPlaceholder")}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="proxyFallbackToDirect">
            {t("notifications.targetDialog.proxy.fallbackToDirect")}
          </Label>
          <Switch
            id="proxyFallbackToDirect"
            checked={proxyFallbackToDirect}
            onCheckedChange={(checked) => onProxyFallbackToDirectChange(checked)}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
