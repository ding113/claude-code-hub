"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { type IpGeoLookupMode, useIpGeo } from "@/hooks/use-ip-geo";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import { AbuseSection, hasAbuseContent } from "./ip-details/abuse-section";
import { hasMeaningfulCoordinates } from "./ip-details/atoms";
import { IpHeroStrip } from "./ip-details/hero";
import { hasLocationContent, LocationSection } from "./ip-details/location-section";
import { hasNetworkContent, NetworkSection } from "./ip-details/network-section";
import { SecuritySection } from "./ip-details/security-section";

export { hasMeaningfulCoordinates };

interface IpDetailsDialogProps {
  ip: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lookupMode?: IpGeoLookupMode;
}

export function IpDetailsDialog({
  ip,
  open,
  onOpenChange,
  lookupMode = "default",
}: IpDetailsDialogProps) {
  const t = useTranslations("ipDetails");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setCopied(false);
    }
  }, [open]);

  const handleCopy = async () => {
    if (!ip) return;

    const ok = await copyTextToClipboard(ip);
    if (ok) {
      setCopied(true);
      toast.success(t("actions.copySuccess"));
      return;
    }

    toast.error(t("actions.copyFailed"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader className="gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle>
                <span className="block break-all font-mono text-sm">{ip ?? "—"}</span>
              </DialogTitle>
              <DialogDescription className="mt-1 sr-only">{t("description")}</DialogDescription>
            </div>
            {ip ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={handleCopy}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? t("actions.copied") : t("actions.copy")}
              </Button>
            ) : null}
          </div>
        </DialogHeader>

        {/* Only mount the content (and its useQuery) when the dialog is open.
            This keeps tests that never open the dialog free of a QueryClient
            dependency. */}
        {open && <IpDetailsContent ip={ip} lookupMode={lookupMode} />}
      </DialogContent>
    </Dialog>
  );
}

function IpDetailsContent({ ip, lookupMode }: { ip: string | null; lookupMode: IpGeoLookupMode }) {
  const t = useTranslations("ipDetails");
  const { data, isLoading, isError } = useIpGeo(ip, { mode: lookupMode });

  if (isLoading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("loading")}</p>;
  }

  if (isError || data?.status === "error") {
    return (
      <div className="py-4">
        <p className="text-sm text-destructive">{t("error")}</p>
        {data?.status === "error" && data.error ? (
          <p className="mt-1 text-xs text-muted-foreground">{data.error}</p>
        ) : null}
      </div>
    );
  }

  if (data?.status === "private") {
    return (
      <div className="py-4">
        <Badge variant="outline">{t("privateIp")}</Badge>
        <p className="mt-2 text-sm text-muted-foreground">{t("privateIpNote")}</p>
      </div>
    );
  }

  if (data?.status !== "ok") return null;

  const { data: result } = data;
  const showLocation = hasLocationContent(result);
  const showNetwork = hasNetworkContent(result);
  const showAbuse = hasAbuseContent(result);

  return (
    <div className="space-y-4">
      {result.hostname && (
        <p className="-mt-1 break-all font-mono text-xs text-muted-foreground">{result.hostname}</p>
      )}

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">
          {t(`version.${result.version}` as "version.ipv4")}
        </Badge>
      </div>

      <IpHeroStrip result={result} />

      <Separator />

      <div className="space-y-1">
        {showLocation && <LocationSection result={result} />}
        {showNetwork && <NetworkSection result={result} />}
        <SecuritySection result={result} />
        {showAbuse && <AbuseSection result={result} />}
      </div>
    </div>
  );
}
